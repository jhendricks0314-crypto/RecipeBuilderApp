// POST /api/ingredient-help
//   { mode: 'substitute', recipe, ingredient, pantryItems? }
//     -> ways to replace or make this ingredient, ranked, with any pantry option first
//   { mode: 'ask', recipe, ingredient, question }
//     -> a direct answer about that ingredient ("which onion does this mean?")
//
// Both are scoped to the specific recipe, so answers account for what the dish
// actually needs — "yellow onion, because it's cooked down" rather than generic
// encyclopedia text.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { claudeJSON, claude, hasClaude } from './_shared/claude.js'
import { logError } from './_shared/log.js'

const SUB_SYSTEM = `You suggest substitutions for ONE ingredient in a specific recipe.
Return ONLY JSON: { "substitutions": [ { "name": string, "ratio": string, "note": string, "fromPantry": boolean, "quality": "great"|"good"|"in a pinch" } ] }
- "name": what to use instead. This may be a single item OR something the cook makes themselves — e.g. replacing pancake mix with flour + baking powder + sugar, or buttermilk with milk + lemon juice. Write those as "1 cup milk + 1 tbsp lemon juice".
- "ratio": how much replaces the called-for amount ("1:1", "use half as much", "1 tsp per clove").
- "note": one short sentence on what changes in the dish — flavour, texture, or cooking behaviour. Be honest when a swap is a real compromise.
- "fromPantry": true only if the substitute is satisfied by the cook's on-hand list.
- "quality": how well it works HERE, in this recipe, not in general.
Return 2-5 options, best first, pantry options first among equals. If nothing works, return an empty array.`

const ASK_SYSTEM = `You answer a cook's question about ONE ingredient in a specific recipe.
Answer in 1-3 short sentences, plain text, no markdown, no preamble.
Be concrete and practical: if they ask which type or colour of onion, name one and say why it suits THIS dish. If they ask about a substitute, give one. If they ask how to prep it, say how.
When the recipe genuinely doesn't care, say so plainly rather than inventing a rule.`

function recipeContext(recipe) {
  if (!recipe) return ''
  const ings = (recipe.ingredients || []).map((i) => `${i.quantity || ''} ${i.item}`.trim()).join(', ')
  const steps = (recipe.steps || []).map((s, i) => `${i + 1}. ${s.text}`).join('\n')
  return `Recipe: ${recipe.name}
${recipe.summary || ''}
Ingredients: ${ings}
Steps:
${steps}`
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (req.method !== 'POST') return bad('Unsupported method.', 405)
  if (!hasClaude()) return bad('This needs ANTHROPIC_API_KEY to be configured.', 503)

  try {
    const { mode, recipe, ingredient, question, pantryItems } = await req.json()
    const item = (ingredient?.item || ingredient || '').toString().trim()
    if (!item) return bad('Which ingredient?')

    const pantry = Array.isArray(pantryItems) ? pantryItems.filter(Boolean) : []
    const ctx = recipeContext(recipe)

    if (mode === 'ask') {
      const q = (question || '').trim()
      if (!q) return bad('What would you like to know?')
      const answer = await claude({
        system: ASK_SYSTEM,
        maxTokens: 400,
        messages: [{
          role: 'user',
          content: `${ctx}\n\nThe cook is asking about this ingredient: "${item}"\nTheir question: "${q}"`,
        }],
      })
      return ok({ answer: String(answer).trim() })
    }

    // default: substitutions
    const data = await claudeJSON({
      system: SUB_SYSTEM,
      maxTokens: 1200,
      messages: [{
        role: 'user',
        content:
          `${ctx}\n\nSuggest substitutions for: "${item}"` +
          (pantry.length ? `\n\nThe cook already has these on hand: ${pantry.join(', ')}` : ''),
      }],
    })

    const substitutions = (data.substitutions || [])
      .filter((s) => s && s.name)
      .slice(0, 5)
      .map((s) => ({
        name: String(s.name),
        ratio: s.ratio || '',
        note: s.note || '',
        fromPantry: !!s.fromPantry,
        quality: ['great', 'good', 'in a pinch'].includes(s.quality) ? s.quality : 'good',
      }))

    return ok({ substitutions })
  } catch (error) {
    await logError({ req, user, action: 'ingredient-help', error })
    return bad(error.code ? error.message : 'Could not look that up. Please try again.', 500)
  }
}
