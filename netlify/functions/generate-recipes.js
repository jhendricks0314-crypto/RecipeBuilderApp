// POST /api/generate-recipes
// Body: { count, budget, whatToCook?, meals?: [{cuisine, tool, time, people, audience, command}] }
// Returns fully-formed recipe objects (not yet saved) with names, summaries,
// timestamps, ingredients, efficient step-by-step instructions, and cost.
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

const SYSTEM = `You are ForkCast's recipe chef. You produce practical home recipes that respect a per-recipe budget.
Return ONLY JSON — an array of recipe objects, no prose, no markdown fences.
Each recipe object must have exactly these fields:
{
  "name": string,                 // a unique, appetizing name
  "summary": string,              // one short sentence describing the dish
  "cuisine": string,
  "tool": string,
  "servings": number,
  "audience": string,
  "estimatedTimeMinutes": number,
  "estimatedCost": number,        // total USD to make the dish, realistic
  "costBreakdown": string,        // one line explaining the estimate
  "ingredients": [ { "item": string, "quantity": string, "estCost": number } ],
  "steps": [ { "text": string, "note": string } ]  // note = optional efficiency tip, else ""
}
Organize steps for real-kitchen efficiency: when a step involves waiting (baking, simmering, resting), the "note" on that step should tell the cook what to prep or start in parallel while they wait.
Keep total ingredient costs at or under the stated budget when at all possible; if impossible, get as close as you can and say so in costBreakdown.`

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

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  if (!hasClaude()) return bad('AI recipe generation needs ANTHROPIC_API_KEY to be configured.', 503)

  try {
    const body = await req.json()
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

    const recipes = await claudeJSON({
      system: SYSTEM,
      maxTokens: 6000,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const now = new Date().toISOString()
    const shaped = (Array.isArray(recipes) ? recipes : [recipes]).map((r) => ({
      id: id('rec_'),
      profileId: user.profileId,
      createdBy: user.email,
      name: r.name || 'Untitled dish',
      summary: r.summary || '',
      cuisine: r.cuisine || 'Mixed',
      tool: r.tool || 'Stove Top',
      servings: Number(r.servings) || 2,
      audience: r.audience || 'adults',
      estimatedTimeMinutes: Number(r.estimatedTimeMinutes) || 30,
      estimatedCost: Number(r.estimatedCost) || 0,
      costBreakdown: r.costBreakdown || '',
      ingredients: Array.isArray(r.ingredients)
        ? r.ingredients.map((i) => ({ item: i.item, quantity: i.quantity || '', estCost: Number(i.estCost) || 0 }))
        : [],
      steps: Array.isArray(r.steps)
        ? r.steps.map((s, idx) => ({ n: idx + 1, text: s.text || String(s), note: s.note || '', comments: [] }))
        : [],
      photos: [],
      imageStyle: null,
      rating: 0,
      comments: [],
      generatedAt: now,
      savedAt: null,
    }))

    return ok({ recipes: shaped })
  } catch (error) {
    await logError({ req, user, action: 'generate-recipes', error })
    return bad('Recipe generation failed. Please try again.', 500)
  }
}
