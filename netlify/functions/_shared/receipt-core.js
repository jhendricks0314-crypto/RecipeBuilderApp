// Shared receipt-parsing logic.
//
// Lives here so the synchronous endpoint and the background runner execute the
// same code — duplicating it would let the two drift apart.
import { claudeJSON, hasClaude, FAST_MODEL } from './claude.js'
import { id } from './blobs.js'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const SYSTEM = `You read a grocery receipt and extract its line items.
Return ONLY JSON: { "store": string|null, "date": string|null, "items": [ ... ] }.
Each item: { "name": string, "price": number, "quantity": number, "unitPrice": number, "barcode": string|null, "isFood": boolean }.
- "isFood" is true only for edible grocery items. Non-food (bags, paper towels, cleaning supplies, batteries) -> false.
- "barcode": many receipts print the item's UPC as a ~12-digit number beside the name. Copy it exactly if present, else null. Never use the long transaction/TC barcode from the bottom.
- If quantity is unclear use 1. unitPrice = price / quantity.
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
