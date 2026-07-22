// Shared receipt-parsing logic.
//
// Lives here so the synchronous endpoint and the background runner execute the
// same code — duplicating it would let the two drift apart.
import { claudeJSON, hasClaude, FAST_MODEL } from './claude.js'
import { id } from './blobs.js'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const SYSTEM = `You read a grocery receipt and extract its line items.
Return ONLY JSON: { "store": string|null, "date": string|null, "items": [ ... ] }.
Each item: { "name": string, "price": number, "quantity": number, "unit": string, "unitPrice": number, "barcode": string|null, "isFood": boolean }.
- "isFood" is true only for edible grocery items. Non-food (bags, paper towels, cleaning supplies, batteries) -> false.
- "barcode": many receipts print the item's UPC as a ~12-digit number beside the name. Copy it exactly if present, else null. Never use the long transaction/TC barcode from the bottom.
CAPTURE HOW THE ITEM IS PRICED — this matters as much as the total.

Weight- or volume-priced items print the rate on a second line. Walmart writes it as
"<amount> <unit> @ 1.0 <unit> /<rate>" with the line total on the right. For example:

    RED GRAPE     085495700100 F
       2.16 lb @ 1.0 lb /1.87        4.04

That is 2.16 lb bought at $1.87 per pound, totalling $4.04. Return it as:
  { "name": "Red Grapes", "price": 4.04, "quantity": 2.16, "unit": "1 lb", "unitPrice": 1.87, ... }

Rules for these three fields:
- "price"     = the line total actually charged (the right-hand number).
- "quantity"  = how much was bought (2.16 for the grapes; 1 for a plain single item).
- "unit"      = what ONE unit of "unitPrice" buys: "1 lb", "1 oz", "1 kg", "1 gal", or "each"
                for anything sold by the piece. Never leave this blank.
- "unitPrice" = the price of ONE such unit (1.87 per lb). For a plain item it equals "price".

Other cases:
- "3 @ 1.50" style multi-buys: quantity 3, unit "each", unitPrice 1.50, price 4.50.
- A plain line with one number: quantity 1, unit "each", unitPrice = price.
- The same product printed on several lines is several separate purchases — return each line.
- Expand abbreviated names into readable ones ("GV MLK 2%" -> "Great Value Milk 2%").
- "date" as YYYY-MM-DD if visible, else null.
Include ALL items with correct isFood flags; the app filters them.`

const bad = (msg) => { const e = new Error(msg); e.code = 'BAD_REQUEST'; throw e }

export async function parseReceipt({ imageBase64, mediaType, store }, { timeoutMs } = {}) {
  if (!hasClaude()) bad('Receipt scanning needs ANTHROPIC_API_KEY to be configured.')
  if (!imageBase64) bad('No file provided.')

  const type = (mediaType || 'image/jpeg').toLowerCase()
  const isPDF = type === 'application/pdf'
  if (!isPDF && !IMAGE_TYPES.includes(type)) {
    bad(
      `Can't read ${type} files. Use a PDF, JPEG, PNG, GIF or WebP — ` +
      'an iPhone HEIC photo usually needs converting first (screenshot it, or export as JPEG).'
    )
  }

  // Claude reads images and PDFs through different content blocks; sending a
  // PDF as an "image" is rejected outright.
  const source = { type: 'base64', media_type: type, data: imageBase64 }
  const block = isPDF ? { type: 'document', source } : { type: 'image', source }

  const parsed = await claudeJSON({
    system: SYSTEM,
    model: FAST_MODEL(),
    maxTokens: 4000,
    timeoutMs,
    messages: [{
      role: 'user',
      content: [
        block,
        {
          type: 'text',
          text: store ? `This receipt is from ${store}. Extract the items.` : 'Extract the items from this receipt.',
        },
      ],
    }],
  })

  const items = (parsed.items || [])
    .filter((i) => i.isFood)
    .map((i) => ({
      id: id('ri_'),
      name: i.name,
      price: Number(i.price) || 0,
      quantity: Number(i.quantity) || 1,
      // What one unit costs, and what that unit is. Shopping lists scale from
      // this — 3 lbs of grapes at $1.87/lb rather than the $4.04 that happened
      // to be on this receipt.
      unit: (i.unit || '').trim() || 'each',
      unitPrice: Number(i.unitPrice) || Number(i.price) || 0,
      barcode: /^\d{8,14}$/.test(String(i.barcode || '').trim()) ? String(i.barcode).trim() : null,
    }))

  return {
    store: store || parsed.store || '',
    date: parsed.date || new Date().toISOString().slice(0, 10),
    items,
    droppedNonFood: (parsed.items || []).filter((i) => !i.isFood).map((i) => i.name),
  }
}
