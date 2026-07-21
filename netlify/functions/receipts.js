// Receipt scanner.
//   POST /api/receipts/parse   { imageBase64, mediaType, store }
//        -> Claude vision reads the receipt, returns FOOD line items only
//           (garbage bags, etc. are dropped) for the user to review/edit.
//   POST /api/receipts         { store, date, items:[] }
//        -> commits reviewed items into the SHARED receipt-price database.
//
// The shared database is intentionally not readable by users — only the
// shopping-list function references it for pricing.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores as S, writeJSON, id } from './_shared/blobs.js'
import { claudeJSON, hasClaude } from './_shared/claude.js'
import { logError, logEvent } from './_shared/log.js'

const SYSTEM = `You read a photo of a grocery store receipt and extract line items.
Return ONLY JSON: { "store": string|null, "date": string|null, "items": [ ... ] }.
Each item: { "name": string, "price": number, "quantity": number, "unitPrice": number, "barcode": string|null, "isFood": boolean }.
- "isFood" is true only for edible grocery items (produce, meat, dairy, pantry, snacks, drinks).
  Non-food (garbage bags, paper towels, cleaning supplies, batteries, gift cards) -> isFood:false.
- "barcode": many receipts (Walmart especially) print the item's UPC as a ~12-digit number next to the item name. Copy it EXACTLY if present, else null. Do not invent one, and do not use the long transaction/TC barcode from the bottom of the receipt.
- If quantity is unclear, use 1. unitPrice = price / quantity.
- Clean up abbreviated names into readable product names (e.g. "GV MLK 2%" -> "Great Value Milk 2%").
- "date" in YYYY-MM-DD if visible, else null.
Include ALL items with correct isFood flags; the app will filter.`

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  const url = new URL(req.url)
  const seg = url.pathname.split('/').filter(Boolean).pop()

  try {
    // ---- Parse a receipt image ----
    if (req.method === 'POST' && seg === 'parse') {
      if (!hasClaude()) return bad('Receipt scanning needs ANTHROPIC_API_KEY to be configured.', 503)
      const { imageBase64, mediaType, store } = await req.json()
      if (!imageBase64) return bad('No image provided.')

      const parsed = await claudeJSON({
        system: SYSTEM,
        maxTokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
              },
              {
                type: 'text',
                text: store ? `This receipt is from ${store}. Extract the items.` : 'Extract the items from this receipt.',
              },
            ],
          },
        ],
      })

      const foodItems = (parsed.items || [])
        .filter((i) => i.isFood)
        .map((i) => ({
          id: id('ri_'),
          name: i.name,
          price: Number(i.price) || 0,
          quantity: Number(i.quantity) || 1,
          unitPrice: Number(i.unitPrice) || Number(i.price) || 0,
          barcode: /^\d{8,14}$/.test(String(i.barcode || '').trim()) ? String(i.barcode).trim() : null,
        }))

      await logEvent({ req, user, action: 'receipt-parse', message: `Parsed ${foodItems.length} food items` })
      return ok({
        store: store || parsed.store || '',
        date: parsed.date || new Date().toISOString().slice(0, 10),
        items: foodItems,
        droppedNonFood: (parsed.items || []).filter((i) => !i.isFood).map((i) => i.name),
      })
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
    await logError({ req, user, action: `receipts:${seg || req.method}`, error })
    return bad(error.code ? error.message : 'Receipt processing failed. Please try again.', 500)
  }
}
