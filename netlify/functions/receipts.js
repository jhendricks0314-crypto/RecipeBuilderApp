// Receipt scanner.
//   POST /api/receipts/parse   { imageBase64, mediaType, store }
//     mediaType may be an image (jpeg/png/gif/webp) or application/pdf — e.g. the
//     PDF receipt Walmart lets you download. Each needs a different content block.
//        -> Claude vision reads the receipt, returns FOOD line items only
//           (garbage bags, etc. are dropped) for the user to review/edit.
//   POST /api/receipts         { store, date, items:[] }
//        -> commits reviewed items into the SHARED receipt-price database.
//
// The shared database is intentionally not readable by users — only the
// shopping-list function references it for pricing.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores as S, writeJSON, id } from './_shared/blobs.js'
import { parseReceipt } from './_shared/receipt-core.js'
import { logError, logEvent } from './_shared/log.js'


export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  const url = new URL(req.url)
  const seg = url.pathname.split('/').filter(Boolean).pop()

  try {
    // ---- Parse a receipt image ----
    if (req.method === 'POST' && seg === 'parse') {
      // Shared with the background runner so both paths behave identically.
      const result = await parseReceipt(await req.json())
      await logEvent({ req, user, action: 'receipt-parse', message: `Parsed ${result.items.length} food items` })
      return ok(result)
    }

    // ---- Commit reviewed items to the shared price DB ----
    if (req.method === 'POST' && (seg === 'receipts' || !seg)) {
      const { store, date, items } = await req.json()
      if (!store?.trim()) return bad('Which store is this receipt from?')
      if (!Array.isArray(items) || !items.length) return bad('No items to save.')
      const day = date || new Date().toISOString().slice(0, 10)
      let saved = 0
      for (const it of items) {
        if (!it.name?.trim()) continue
        const rid = id('ri_')
        await writeJSON(S.receiptItems(), rid, {
          id: rid,
          name: it.name.trim(),
          store: store.trim(),
          date: day,
          price: Number(it.price) || 0,
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unitPrice) || Number(it.price) || 0,
          barcode: it.barcode || null,
          unit: it.unit || '',
          source: 'receipt',
          contributedBy: user.email,
          createdAt: new Date().toISOString(),
        })
        saved++
      }
      await logEvent({ req, user, action: 'receipt-commit', message: `Committed ${saved} items from ${store}` })
      return ok({ saved })
    }

    return bad('Unsupported request.', 405)
  } catch (error) {
    if (error.code === 'BAD_REQUEST') return bad(error.message)
    await logError({ req, user, action: `receipts:${seg || req.method}`, error })
    return bad(error.code ? error.message : 'Receipt processing failed. Please try again.', 500)
  }
}
