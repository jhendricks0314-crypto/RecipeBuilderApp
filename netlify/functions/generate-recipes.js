// POST /api/generate-recipes
//
// Two modes:
//  1. GENERATE  { count, budget, whatToCook?, meals?, pantryItems?, onlyPantry? }
//     -> new recipes. Each one carries a `thread`: the conversation that produced
//        it (the cook's request + the recipe Claude returned).
//
//  2. REVISE    { revise: true, recipe, command, budget?, pantryItems? }
//     -> revises THAT recipe by continuing its own thread, so a correction like
//        "less spicy" edits the original dish instead of inventing a new one.
//        The full history for that single recipe is replayed to Claude.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { claudeJSON, hasClaude } from './_shared/claude.js'
import { id } from './_shared/blobs.js'
import { logError } from './_shared/log.js'

const TOOLS = ['Grill', 'Pellet Smoker', 'Oven', 'Stove Top', 'Nothing']
const TIMES = {
  quick: 'must be quick (under ~20 minutes)',
  moderate: 'moderate time, roughly 30–45 minutes',
  none: 'no time constraint',
}

const RECIPE_SHAPE = `{
  "name": string,                 // a unique, appetizing name
  "summary": string,              // one short sentence describing the dish
  "cuisine": string,
  "tool": string,
  "servings": number,
  "audience": string,
  "estimatedTimeMinutes": number,
  "estimatedCost": number,        // total USD to make the dish, realistic
  "costBreakdown": string,        // one line explaining the estimate
  "ingredients": [ { "item": string, "quantity": string, "estCost": number, "have": boolean } ],
  "steps": [ { "text": string, "note": string } ]  // note = optional efficiency tip, else ""
}
For each ingredient, set "have" to true only when the cook already has it on hand (an item from the on-hand list, if provided, or an obvious basic staple like salt/pepper/water); otherwise false.
Organize steps for real-kitchen efficiency: when a step involves waiting (baking, simmering, resting), the "note" on that step should say what to prep or start in parallel while they wait.
Keep total ingredient costs at or under the stated budget when possible; if impossible, get as close as you can and say so in costBreakdown.`

const SYSTEM = `You are ForkCast's recipe chef. You produce practical home recipes that respect a per-recipe budget.
Return ONLY JSON — an array of recipe objects, no prose, no markdown fences.
Each recipe object must have exactly these fields:
${RECIPE_SHAPE}`

// Revision keeps the SAME dish and applies the correction to it.
const REVISE_SYSTEM = `You are ForkCast's recipe chef, revising a recipe you already wrote for this cook.
The conversation so far contains the cook's original request and the recipe you produced.
Apply the cook's new correction to THAT SAME recipe.
Rules:
- Keep the same dish and its intent. Do NOT invent a different meal. Change only what the correction asks for (and whatever must change as a consequence).
- Keep the recipe name unless the correction makes it inaccurate; then adjust it minimally.
- Re-check cost, ingredients, and steps so the revised recipe stays coherent and complete.
Return ONLY JSON — a SINGLE recipe object, no prose, no markdown fences, with exactly these fields:
${RECIPE_SHAPE}`

function mealSpec(m, budget) {
  const cuisine = m.cuisine === 'Random' || !m.cuisine ? 'any cuisine you think fits best' : m.cuisine
  const tool = TOOLS.includes(m.tool) ? m.tool : 'any tool'
  const time = TIMES[m.time] || TIMES.none
  const audience = m.audience || 'adults'
  const people = m.people || 2
  const cmd = m.command?.trim() ? `\n  Special request from the cook: "${m.command.trim()}" — follow it.` : ''
  return `- Cuisine: ${cuisine}
  Cooking tool: ${tool}
  Time available: ${time}
  Serves: ${people} people
  Audience: ${audience}
  Budget: about $${budget.toFixed(2)} for this recipe${cmd}`
}

function pantryClause(pantryItems, onlyPantry) {
  const pantry = Array.isArray(pantryItems) ? pantryItems.map((s) => String(s).trim()).filter(Boolean) : []
  if (!pantry.length) return ''
  return `\n\nThe cook already has these items on hand: ${pantry.join(', ')}.
Build the recipe around these items. ${
    onlyPantry
      ? 'Use ONLY these items plus basic staples (salt, pepper, cooking oil, water, common dried spices) — avoid requiring other purchases; if something small is truly unavoidable, keep it minimal and mark it have:false.'
      : 'Prefer these items; you may add a few common extra ingredients where needed.'
  }`
}

// Turn Claude's raw recipe JSON into a full ForkCast recipe object.
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
    audience: r.audience || 'adults',
    estimatedTimeMinutes: Number(r.estimatedTimeMinutes) || 30,
    estimatedCost: Number(r.estimatedCost) || 0,
    costBreakdown: r.costBreakdown || '',
    ingredients: Array.isArray(r.ingredients)
      ? r.ingredients.map((i) => ({ item: i.item, quantity: i.quantity || '', estCost: Number(i.estCost) || 0, have: !!i.have }))
      : [],
    steps: Array.isArray(r.steps)
      ? r.steps.map((s, idx) => ({ n: idx + 1, text: s.text || String(s), note: s.note || '', comments: [] }))
      : [],
    photos: existing?.photos || [],
    rating: existing?.rating || 0,
    comments: existing?.comments || [],
    generatedAt: existing?.generatedAt || new Date().toISOString(),
    revisedAt: existing ? new Date().toISOString() : null,
    savedAt: existing?.savedAt || null,
  }
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  if (!hasClaude()) return bad('AI recipe generation needs ANTHROPIC_API_KEY to be configured.', 503)

  try {
    const body = await req.json()

    // ---------- Mode 2: revise one recipe, continuing its own thread ----------
    if (body.revise) {
      const prev = body.recipe
      const command = (body.command || '').trim()
      if (!prev) return bad('Nothing to revise.')
      if (!command) return bad('Tell me what to change.')

      // Replay this recipe's conversation. If it has no thread yet (e.g. an older
      // saved recipe), reconstruct one from the recipe itself so the model still
      // has the full context of the dish it is editing.
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

      const revised = await claudeJSON({
        system: REVISE_SYSTEM,
        maxTokens: 4000,
        messages,
      })
      const one = Array.isArray(revised) ? revised[0] : revised
      const recipe = shape(one, user, prev)

      // Grow the thread so the NEXT correction sees this one too.
      recipe.thread = [
        ...messages,
        { role: 'assistant', content: JSON.stringify(stripForThread(recipe)) },
      ]
      return ok({ recipe })
    }

    // ---------- Mode 1: generate new recipes ----------
    const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 6)
    const budget = Math.max(Number(body.budget) || 15, 1)

    let userPrompt
    if (body.whatToCook?.trim()) {
      userPrompt = `Generate ${count} recipe(s). The cook wants to make: "${body.whatToCook.trim()}".
Budget per recipe: about $${budget.toFixed(2)}. Serve 2–4 unless the request implies otherwise.`
    } else {
      const meals = Array.isArray(body.meals) && body.meals.length ? body.meals : [{}]
      const specs = meals.slice(0, count).map((m) => mealSpec(m, budget)).join('\n')
      userPrompt = `Generate ${count} recipe(s), one per spec below:\n${specs}`
    }
    userPrompt += pantryClause(body.pantryItems, body.onlyPantry)

    const recipes = await claudeJSON({
      system: SYSTEM,
      maxTokens: 6000,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const shaped = (Array.isArray(recipes) ? recipes : [recipes]).map((r) => {
      const rec = shape(r, user, null)
      // Seed this recipe's own conversation: the request that produced it, and it.
      rec.thread = [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: JSON.stringify(stripForThread(rec)) },
      ]
      return rec
    })

    return ok({ recipes: shaped })
  } catch (error) {
    await logError({ req, user, action: 'generate-recipes', error })
    return bad('Recipe generation failed. Please try again.', 500)
  }
}

// Only the recipe content goes into the thread — not ids, photos, or the thread
// itself (that would nest infinitely and waste tokens).
function stripForThread(r) {
  return {
    name: r.name,
    summary: r.summary,
    cuisine: r.cuisine,
    tool: r.tool,
    servings: r.servings,
    audience: r.audience,
    estimatedTimeMinutes: r.estimatedTimeMinutes,
    estimatedCost: r.estimatedCost,
    costBreakdown: r.costBreakdown,
    ingredients: r.ingredients,
    steps: (r.steps || []).map((s) => ({ text: s.text, note: s.note || '' })),
  }
}
