// POST /api/recipe-cost  { recipe, zip? }
// Estimates what a recipe costs to make, using the SAME pricing pipeline as the
// shopping list: recorded prices first, AI estimates for the rest, everything
// scaled to the quantity the recipe actually calls for.
//
// This is deliberately not the model guessing a dollar figure — it's priced from
// your own receipts where they exist, so the number means something.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores as S, readJSON, writeJSON } from './_shared/blobs.js'
import { priceItems } from './_shared/pricing.js'
import { logError } from './_shared/log.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  if (req.method !== 'POST') return bad('Unsupported method.', 405)

  try {
    const { recipe, zip } = await req.json()
    if (!recipe?.ingredients?.length) return bad('No ingredients to price.')

    const profile = await readJSON(S.profiles(), user.profileId)
    const useZip = (zip || '').trim() || profile?.zip || ''
    if (zip && zip.trim() && zip.trim() !== profile?.zip) {
      profile.zip = zip.trim()
      await writeJSON(S.profiles(), profile.id, profile)
    }

    // Things already in the pantry cost nothing extra to cook with.
    const toBuy = recipe.ingredients.filter((i) => !i.have)
    const priced = await priceItems(
      toBuy.map((i) => ({ name: i.item, quantity: i.quantity })),
      { zip: useZip, preferredStores: profile?.preferredStores || [] }
    )

    let total = 0
    let known = 0
    const lines = toBuy.map((i) => {
      const p = priced.get(i.item)
      if (p?.lineTotal != null) { total += p.lineTotal; known++ }
      return {
        item: i.item,
        quantity: i.quantity || '',
        lineTotal: p?.lineTotal ?? null,
        store: p?.best?.store || null,
        source: p?.best?.source || null,
      }
    })

    const coverage = toBuy.length ? known / toBuy.length : 1
    return ok({
      total: Math.round(total * 100) / 100,
      perServing: recipe.servings ? Math.round((total / recipe.servings) * 100) / 100 : null,
      lines,
      pantryItems: recipe.ingredients.length - toBuy.length,
      coverage,                        // share of shopping ingredients we could price
      zip: useZip,
      // Honest about confidence: a total built from 3 of 11 ingredients is a
      // floor, not an estimate, and the UI says so.
      confidence: coverage >= 0.8 ? 'good' : coverage >= 0.5 ? 'partial' : 'low',
    })
  } catch (error) {
    await logError({ req, user, action: 'recipe-cost', error })
    return bad(error.code ? error.message : 'Could not price this recipe.', 500)
  }
}
