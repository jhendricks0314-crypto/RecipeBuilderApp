// Pantry — what the household currently has on hand. Stored as a single doc per
// profile (fast to load/save) and shared across everyone on the profile.
//   GET  /api/pantry            -> { items: [...] }
//   PUT  /api/pantry  { items } -> replace the whole list
//   POST /api/pantry  { items } -> append items (dedupes by name+category)
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores, readJSON, writeJSON, id } from './_shared/blobs.js'
import { logError } from './_shared/log.js'

const LOCATIONS = ['Pantry', 'Refrigerator', 'Freezer', 'Deep Freeze']
const normLocation = (v) => LOCATIONS.find((l) => l.toLowerCase() === String(v || '').trim().toLowerCase()) || 'Pantry'

const CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry & Dry Goods',
  'Canned & Jarred', 'Condiments & Sauces', 'Spices & Baking', 'Frozen',
  'Snacks', 'Beverages', 'Other',
]

// Map any free-form category string to one of the canonical buckets.
function normalizeCategory(s) {
  const t = (s || '').toLowerCase()
  if (/(produce|fruit|vegetable|veggie|greens|herb\b)/.test(t)) return 'Produce'
  if (/(meat|seafood|fish|poultry|chicken|beef|pork|deli)/.test(t)) return 'Meat & Seafood'
  if (/(dairy|milk|cheese|yogurt|egg|butter|cream)/.test(t)) return 'Dairy & Eggs'
  if (/(bakery|bread|bagel|tortilla|bun|roll|pastr)/.test(t)) return 'Bakery'
  if (/(frozen)/.test(t)) return 'Frozen'
  if (/(can|jar|soup|beans|tomato sauce|broth)/.test(t)) return 'Canned & Jarred'
  if (/(condiment|sauce|ketchup|mustard|mayo|dressing|oil|vinegar|syrup|honey)/.test(t)) return 'Condiments & Sauces'
  if (/(spice|season|baking|flour|sugar|yeast|extract|salt|pepper)/.test(t)) return 'Spices & Baking'
  if (/(snack|chip|cracker|cookie|candy|nuts|bar\b|popcorn)/.test(t)) return 'Snacks'
  if (/(beverage|drink|juice|soda|coffee|tea|water|wine|beer)/.test(t)) return 'Beverages'
  if (/(pasta|rice|grain|cereal|dry goods|pantry|noodle|oats|lentil|quinoa)/.test(t)) return 'Pantry & Dry Goods'
  return CATEGORIES.includes(s) ? s : 'Other'
}

function cleanItem(raw) {
  const name = (raw.name || '').trim()
  if (!name) return null
  return {
    id: raw.id && String(raw.id).startsWith('pit_') ? raw.id : id('pit_'),
    name,
    category: normalizeCategory(raw.category),
    location: normLocation(raw.location),
    quantity: (raw.quantity || '').toString().trim(),
    note: (raw.note || '').trim(),
    barcode: raw.barcode || null,
    source: raw.source || 'manual',
    addedAt: raw.addedAt || new Date().toISOString(),
  }
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  const key = user.profileId

  try {
    if (req.method === 'GET') {
      const doc = await readJSON(stores.pantry(), key)
      return ok({ items: doc?.items || [] })
    }

    if (req.method === 'PUT') {
      const { items } = await req.json()
      const clean = (Array.isArray(items) ? items : []).map(cleanItem).filter(Boolean)
      await writeJSON(stores.pantry(), key, { profileId: key, items: clean, updatedAt: new Date().toISOString() })
      return ok({ items: clean })
    }

    if (req.method === 'POST') {
      const { items } = await req.json()
      const incoming = (Array.isArray(items) ? items : []).map(cleanItem).filter(Boolean)
      const doc = await readJSON(stores.pantry(), key)
      const existing = doc?.items || []
      const seen = new Set(existing.map((i) => `${i.name.toLowerCase()}|${i.location}`))
      const merged = [...existing]
      for (const it of incoming) {
        const k = `${it.name.toLowerCase()}|${it.location}`
        if (!seen.has(k)) { seen.add(k); merged.push(it) }
      }
      await writeJSON(stores.pantry(), key, { profileId: key, items: merged, updatedAt: new Date().toISOString() })
      return ok({ items: merged, added: incoming.length })
    }

    return bad('Unsupported method.', 405)
  } catch (error) {
    await logError({ req, user, action: `pantry:${req.method}`, error })
    return bad('Something went wrong with your pantry.', 500)
  }
}
