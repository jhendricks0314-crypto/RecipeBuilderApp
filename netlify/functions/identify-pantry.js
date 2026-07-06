// POST /api/identify-pantry  { imageBase64, mediaType }
// Uses Claude vision to identify grocery/pantry items visible in a photo of a
// cabinet, fridge, or counter, and returns them with a category for review.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { claudeJSON, hasClaude } from './_shared/claude.js'
import { logError, logEvent } from './_shared/log.js'

const SYSTEM = `You identify food and grocery items visible in a photo of someone's kitchen cabinet, pantry, fridge, or counter.
Return ONLY JSON: { "items": [ { "name": string, "category": string, "quantity": string } ] }.
Rules:
- List each distinct food/ingredient you can identify. Use clear, generic names ("black beans", "olive oil", "cheddar cheese"), including a brand only if clearly legible.
- "category" must be one of: Produce, Meat & Seafood, Dairy & Eggs, Bakery, Pantry & Dry Goods, Canned & Jarred, Condiments & Sauces, Spices & Baking, Frozen, Snacks, Beverages, Other.
- "quantity" is what you can tell (e.g. "1 can", "half full", "2"), else "".
- Only include items you can actually see and reasonably identify. Do not invent items. Skip non-food objects.`

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  if (!hasClaude()) return bad('Photo identification needs ANTHROPIC_API_KEY to be configured.', 503)

  try {
    const { imageBase64, mediaType } = await req.json()
    if (!imageBase64) return bad('No image provided.')

    const parsed = await claudeJSON({
      system: SYSTEM,
      maxTokens: 3000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: 'Identify the food and grocery items you can see.' },
          ],
        },
      ],
    })

    const items = (parsed.items || [])
      .filter((i) => i.name?.trim())
      .map((i) => ({ name: i.name.trim(), category: i.category || 'Other', quantity: (i.quantity || '').toString().trim(), source: 'photo' }))

    await logEvent({ req, user, action: 'identify-pantry', message: `Identified ${items.length} items` })
    return ok({ items })
  } catch (error) {
    await logError({ req, user, action: 'identify-pantry', error })
    return bad('Could not read that photo. Try again or add items by hand.', 500)
  }
}
