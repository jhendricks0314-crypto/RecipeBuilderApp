// GET /api/barcode-lookup?upc=0123456789012
// Looks up a product by barcode using Open Food Facts — a free, open database,
// no API key required. Returns a name + rough category we can drop into the
// pantry (category gets normalized when the item is saved).
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores as S, listAll } from './_shared/blobs.js'
import { logError } from './_shared/log.js'

// Open Food Facts asks callers to identify themselves in the User-Agent.
const UA = 'RAIning Recipes/1.0 (personal pantry app)'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  const url = new URL(req.url)
  const upc = (url.searchParams.get('upc') || '').replace(/\D/g, '')
  if (!upc) return bad('No barcode provided.')

  try {
    // Your own price history wins: if this UPC is already in the price database
    // (usually captured from a receipt, where the UPC is printed next to the
    // price), we already know the item AND what you paid — no lookup needed.
    const upc = new URL(req.url).searchParams.get('upc')
    const records = (await listAll(S.receiptItems())).filter((r) => r.barcode && r.barcode === upc)
    if (records.length) {
      records.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      const latest = records[0]
      const byStore = {}
      for (const r of records) {
        if (!byStore[r.store] || (r.date || '') > (byStore[r.store].date || '')) {
          byStore[r.store] = { store: r.store, price: r.unitPrice ?? r.price, date: r.date }
        }
      }
      return ok({
        found: true,
        name: latest.name,
        barcode: upc,
        source: 'price-history',
        priceHistory: Object.values(byStore).sort((a, b) => a.price - b.price),
      })
    }

    const api = `https://world.openfoodfacts.org/api/v2/product/${upc}.json?fields=product_name,brands,categories,quantity,image_front_small_url`
    const res = await fetch(api, { headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!res.ok) throw new Error(`Open Food Facts ${res.status}`)
    const data = await res.json()

    if (data.status !== 1 || !data.product) {
      return ok({ found: false, upc })
    }
    const p = data.product
    const brand = (p.brands || '').split(',')[0]?.trim()
    const baseName = p.product_name?.trim() || ''
    const name = [brand, baseName].filter(Boolean).join(' ') || `Item ${upc}`
    const category = (p.categories || '').split(',').pop()?.trim() || ''

    return ok({
      found: true,
      upc,
      name,
      category,
      quantity: p.quantity || '',
      image: p.image_front_small_url || null,
    })
  } catch (error) {
    await logError({ req, user, action: 'barcode-lookup', error })
    return bad('Barcode lookup failed. Try again or add the item by hand.', 500)
  }
}
