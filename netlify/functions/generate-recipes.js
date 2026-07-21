// POST /api/generate-recipes
//
// Two modes:
//  1. SUGGEST   { suggest: true, whatToCook, prefs, pantryItems? }
//     -> up to 10 ideas as {name, summary} only. Cheap and fast: the cook picks
//        one before we spend tokens writing a full recipe. If the request is
//        already specific ("chicken parmesan"), it returns just 1-2 — there's no
//        point padding a precise ask with variations nobody wanted.
//  2. GENERATE  { whatToCook, prefs, pantryItems?, pick? }
//  3. REVISE    { revise: true, recipe, command, prefs?, pantryItems? }
//     -> revises THAT recipe by continuing its own thread, so a correction like
//        "less spicy" edits the original dish instead of inventing a new one.
//
// prefs (all household-level, stored on the profile):
//   { people, tools: [], exclusions: [], diets: [], trends: bool, onlyPantry: bool }
//
// No cost/budget: item pricing lives in the price database + ZIP estimates, which
// are far more accurate than a model guessing what groceries cost.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { claudeJSON, hasClaude } from './_shared/claude.js'
import { id } from './_shared/blobs.js'
import { logError } from './_shared/log.js'

const RECIPE_SHAPE = `{
  "name": string,                 // a unique, appetizing name
  "summary": string,              // one short sentence describing the dish
  "cuisine": string,
  "tool": string,                 // the main tool used — MUST be one the cook has
  "servings": number,
  "estimatedTimeMinutes": number,
  "highlights": string,           // "" normally. When trends are on: one line naming the modern ingredient/technique used and why it works.
  "ingredients": [ { "item": string, "quantity": string, "have": boolean } ],
  "steps": [ { "text": string, "note": string, "uses": [ { "item": string, "amount": string } ] } ]
}
For every step, "uses" lists the ingredients consumed IN THAT STEP so the cook can measure as they go:
- "item" MUST match an ingredient name from the ingredients list exactly.
- "amount" is how much of it that step uses ("1 tsp", "half", "the rest").
- CRITICAL: when an ingredient is used across several steps, split it so the per-step amounts ADD UP to the total in the ingredients list. If the list says 1 1/2 tsp salt and two steps use it, they might be "1 tsp" and "1/2 tsp" — never "1 1/2 tsp" twice.
- Only list what is actually added or used in that step. A step like "bake for 30 minutes" uses nothing, so "uses" is [].
- Ingredients used in their entirety in one step get the full amount.

Set "have" to true ONLY for items the cook already has (from the on-hand list, or an obvious basic staple like salt/pepper/water/cooking oil). Everything else is false — those are the things they'll need to buy.
Organize steps for real-kitchen efficiency: when a step involves waiting (baking, simmering, resting), the "note" on that step should say what to prep or start in parallel while they wait.`

const BASE_RULES = `You are RAIning Recipes's recipe chef. You write practical, well-tested home recipes.
Return ONLY JSON — no prose, no markdown fences.`

const REVISE_SYSTEM = `${BASE_RULES}
You are revising a recipe you already wrote for this cook. The conversation contains their original request and the recipe you produced.
Apply their correction to THAT SAME recipe.
Rules:
- Keep the same dish and its intent. Do NOT invent a different meal. Change only what the correction asks for (and whatever must change as a consequence).
- Keep the recipe name unless the correction makes it inaccurate; then adjust it minimally.
- Keep honoring every constraint from the original request (tools, exclusions, diets, pantry rules).
Return a SINGLE recipe object with exactly these fields:
${RECIPE_SHAPE}`

const GEN_SYSTEM = `${BASE_RULES}
Return an array containing exactly ONE recipe object with these fields:
${RECIPE_SHAPE}`

// Step one of generating: cheap ideas, so the cook picks a dish before we spend
// tokens writing it out in full.
const SUGGEST_SYSTEM = `${BASE_RULES}
You are proposing recipe IDEAS, not writing recipes. Return an array of objects:
[ { "name": string, "summary": string, "cuisine": string, "estimatedTimeMinutes": number, "tool": string } ]
- "summary" is ONE sentence describing the dish and what makes it worth cooking.
- Every idea must be a genuinely DIFFERENT dish — not the same recipe with a swapped garnish.
- Honour every constraint given (tools, exclusions, diets, pantry rules) in every idea.

How many to return depends on how specific the request is:
- Vague or open ("something with chicken", "quick weeknight dinners") -> up to 10 varied ideas.
- Moderately specific ("a chicken pasta bake") -> 3 to 5 sensible variations.
- Precise ("chicken parmesan", "my grandmother's beef stew") -> 1 or 2. Do NOT pad it out.
Return only as many genuinely distinct ideas as the request actually supports.`

// Turn the household's saved options into hard constraints for the model.
function constraints(prefs = {}, pantryItems = []) {
  const out = []

  const people = Number(prefs.people) || 0
  if (people > 0) out.push(`Serves: exactly ${people} people. Scale all quantities to that.`)

  const tools = (prefs.tools || []).filter(Boolean)
  if (tools.length) {
    out.push(`Available cooking tools: ${tools.join(', ')}. The recipe MUST be cookable with ONLY these — do not require any other appliance. Set "tool" to whichever of these is primary.`)
  }

  const excl = (prefs.exclusions || []).filter(Boolean)
  if (excl.length) {
    out.push(`HARD EXCLUSIONS — the recipe must contain NONE of these, in any form, including as a hidden component of a sauce, mix, marinade, or garnish: ${excl.join(', ')}. Treat these as strict (they may be allergies or firm dislikes). If a classic version of the dish needs one, substitute it and say so in the summary.`)
  }

  // Nutrition goals and named diets are stored separately but constrain the
  // same thing — the model gets them as one set of dietary requirements.
  const diets = [...(prefs.nutrition || []), ...(prefs.diets || [])].filter(Boolean)
  if (diets.length) {
    out.push(`Dietary requirements: ${diets.join(', ')}. The recipe must genuinely satisfy these, not merely gesture at them.`)
  }

  const pantry = (pantryItems || []).map((s) => String(s).trim()).filter(Boolean)
  if (pantry.length) {
    out.push(
      prefs.onlyPantry
        ? `PANTRY ONLY. The cook has: ${pantry.join(', ')}.
Use ONLY these items plus basic staples (salt, pepper, cooking oil, water, common dried spices). Do NOT require anything else to be bought — if the dish cannot be made without a purchase, choose a different dish that can. Every ingredient should be marked have:true.`
        : `The cook already has: ${pantry.join(', ')}.
Build the dish around these where it makes sense, and mark them have:true. You may add other ingredients — mark those have:false so the cook knows what to buy.`
    )
  } else if (prefs.onlyPantry) {
    out.push(`The cook asked for pantry-only recipes but their pantry is empty — say so in the summary and keep the ingredient list to basic staples.`)
  }

  if (prefs.trends) {
    out.push(`MODERN / TRENDING MODE: lean into what's current in home cooking right now. Where it genuinely improves the dish, reach for contemporary ingredients, seasonings, condiments, or techniques rather than the default 1990s version — think along the lines of chili crisp, gochujang, miso, za'atar, hot honey, black garlic, tahini, harissa, preserved lemon, furikake, koji, fish-sauce caramel, or methods like dry-brining, reverse-searing, high-heat sheet-pan roasting, cold-ferment doughs, air-fryer finishing, or smash-and-sear.
Do not chase novelty for its own sake and do not use anything hard to find in an ordinary supermarket. Use "highlights" to name the modern element you used and why it works.`)
  } else {
    out.push(`Keep to familiar, widely-available ingredients and classic technique. Leave "highlights" as "".`)
  }

  return out.length ? `\n\nConstraints:\n${out.map((c) => `- ${c}`).join('\n')}` : ''
}

function shape(r, user, existing) {
  return {
    id: existing?.id || id('rec_'),
    profileId: user.profileId,
    createdBy: user.email,
    name: r.name || existing?.name || 'Untitled dish',
    summary: r.summary || '',
    cuisine: r.cuisine || 'Mixed',
    tool: r.tool || 'Stove Top',
    servings: Number(r.servings) || 2,
    estimatedTimeMinutes: Number(r.estimatedTimeMinutes) || 30,
    highlights: r.highlights || '',
    ingredients: Array.isArray(r.ingredients)
      ? r.ingredients.map((i) => ({ item: i.item, quantity: i.quantity || '', have: !!i.have }))
      : [],
    steps: Array.isArray(r.steps)
      ? r.steps.map((s, idx) => ({
          n: idx + 1,
          text: s.text || String(s),
          note: s.note || '',
          // What this step consumes, so the cook can measure per step instead of
          // re-reading the whole ingredient list.
          uses: Array.isArray(s.uses)
            ? s.uses
                .filter((u) => u && (u.item || u.name))
                .map((u) => ({ item: String(u.item || u.name).trim(), amount: String(u.amount || '').trim() }))
            : [],
          comments: [],
        }))
      : [],
    photos: existing?.photos || [],
    rating: existing?.rating || 0,
    comments: existing?.comments || [],
    generatedAt: existing?.generatedAt || new Date().toISOString(),
    revisedAt: existing ? new Date().toISOString() : null,
    savedAt: existing?.savedAt || null,
  }
}

function stripForThread(r) {
  return {
    name: r.name, summary: r.summary, cuisine: r.cuisine, tool: r.tool,
    servings: r.servings, estimatedTimeMinutes: r.estimatedTimeMinutes,
    highlights: r.highlights || '',
    ingredients: r.ingredients,
    steps: (r.steps || []).map((s) => ({ text: s.text, note: s.note || '', uses: s.uses || [] })),
  }
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  if (!hasClaude()) return bad('AI recipe generation needs ANTHROPIC_API_KEY to be configured.', 503)

  try {
    const body = await req.json()
    const prefs = body.prefs || {}

    // ---------- Revise one recipe, continuing its own thread ----------
    if (body.revise) {
      const prev = body.recipe
      const command = (body.command || '').trim()
      if (!prev) return bad('Nothing to revise.')
      if (!command) return bad('Tell me what to change.')

      const thread = Array.isArray(prev.thread) && prev.thread.length
        ? prev.thread
        : [
            { role: 'user', content: `Create this recipe: ${prev.name}. ${prev.summary || ''}` },
            { role: 'assistant', content: JSON.stringify(stripForThread(prev)) },
          ]

      const messages = [
        ...thread,
        { role: 'user', content: `Correction: ${command}\n\nApply this to the recipe above and return the complete updated recipe as JSON.` },
      ]

      const revised = await claudeJSON({ system: REVISE_SYSTEM, maxTokens: 8000, messages })
      const recipe = shape(Array.isArray(revised) ? revised[0] : revised, user, prev)
      recipe.thread = [...messages, { role: 'assistant', content: JSON.stringify(stripForThread(recipe)) }]
      return ok({ recipe })
    }

    // ---------- Suggest ideas (names + summaries only) ----------
    if (body.suggest) {
      const what = (body.whatToCook || '').trim()
      if (!what) return bad('Tell me what you want to cook.')

      const prompt = `The cook wants: "${what}".
Propose recipe ideas that fit.` + constraints(prefs, body.pantryItems)

      const raw = await claudeJSON({
        system: SUGGEST_SYSTEM,
        maxTokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      })
      const suggestions = (Array.isArray(raw) ? raw : [raw])
        .filter((x) => x && x.name)
        .slice(0, 10)
        .map((x) => ({
          name: String(x.name),
          summary: String(x.summary || ''),
          cuisine: x.cuisine || '',
          tool: x.tool || '',
          estimatedTimeMinutes: Number(x.estimatedTimeMinutes) || null,
        }))
      return ok({ suggestions })
    }

    // ---------- Generate a full recipe ----------
    const what = (body.whatToCook || '').trim()
    if (!what) return bad('Tell me what you want to cook.')

    // `pick` is the suggestion the cook chose — write THAT dish specifically.
    const pick = body.pick
    const userPrompt = pick?.name
      ? `Write the full recipe for: "${pick.name}".${pick.summary ? ` It was described as: "${pick.summary}".` : ''}
The cook originally asked for: "${what}". Stay true to the dish named above.` + constraints(prefs, body.pantryItems)
      : `Generate 1 recipe. The cook wants: "${what}".` + constraints(prefs, body.pantryItems)

    const recipes = await claudeJSON({
      system: GEN_SYSTEM,
      maxTokens: 8000,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const shaped = (Array.isArray(recipes) ? recipes : [recipes]).map((r) => {
      const rec = shape(r, user, null)
      rec.thread = [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: JSON.stringify(stripForThread(rec)) },
      ]
      return rec
    })

    return ok({ recipes: shaped, recipe: shaped[0] })
  } catch (error) {
    await logError({ req, user, action: 'generate-recipes', error, detail: error.detail || error.partial || null })
    return bad(error.code ? error.message : `Recipe generation failed: ${error.message}`, 500)
  }
}
