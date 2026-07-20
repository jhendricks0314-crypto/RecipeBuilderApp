// The price database — real prices you've recorded.
//   GET    /api/prices?q=milk        -> list recorded prices (newest first)
//   POST   /api/prices               { name, store, price, unit?, quantity?, date?, barcode? }
//   DELETE /api/prices?id=ri_...     -> remove an entry
//
// Entries come from three places: a manual price, a barcode scan, or a scanned
// receipt. Shopping lists always prefer these over AI estimates.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores as S, readJSON, writeJSON, listAll, id } from './_shared/blobs.js'
import { logError, logEvent } from './_shared/log.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  const url = new URL(req.url)

  try {
    if (req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim()
      let all = await listAll(S.receiptItems())
      if (q) all = all.filter((r) => (r.name || '').toLowerCase().includes(q) || (r.store || '').toLowerCase().includes(q))
      all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))
      const storeNames = [...new Set(all.map((r) => r.store).filter(Boolean))].sort()
      return ok({ prices: all.slice(0, 500), count: all.length, stores: storeNames })
    }

    if (req.method === 'POST') {
      const body = await req.json()
      const name = (body.name || '').trim()
      const store = (body.store || '').trim()
      const price = Number(body.price)
      if (!name) return bad('What item is this?')
      if (!store) return bad('Which store is this price from?')
      if (!isFinite(price) || price <= 0) return bad('Enter a valid price.')

      const qty = Number(body.quantity) || 1
      const rid = id('ri_')
      const rec = {
        id: rid,
        name,
        store,
        date: body.date || new Date().toISOString().slice(0, 10),
        price,
        quantity: qty,
        // What one unit of this price buys — "1 lb", "dozen", "16 oz box".
        // Drives per-pound style maths on shopping lists.
        unit: (body.unit || '').trim(),
        unitPrice: Math.round((price / qty) * 100) / 100,
        barcode: body.barcode || null,
        source: body.source || 'manual', // manual | barcode | receipt
        contributedBy: user.email,
        createdAt: new Date().toISOString(),
      }
      await writeJSON(S.receiptItems(), rid, rec)
      await logEvent({ req, user, action: 'price-add', message: `${name} @ ${store} $${price}` })
      return ok({ price: rec })
    }

    if (req.method === 'DELETE') {
      const rid = url.searchParams.get('id')
      const rec = await readJSON(S.receiptItems(), rid)
      if (!rec) return bad('Not found.', 404)
      await S.receiptItems().delete(rid)
      return ok({ deleted: true })
    }

    return bad('Unsupported method.', 405)
  } catch (error) {
    await logError({ req, user, action: `prices:${req.method}`, error })
    return bad('Something went wrong with the price database.', 500)
  }
}
