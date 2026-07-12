// ForkCast pricing.
//
// Two sources, in strict priority order:
//   1. THE PRICE DATABASE — real prices you've recorded (scanned receipts, barcode
//      scans, manual entries). Always wins: it's what you actually paid.
//   2. AI ESTIMATE — for anything with no recorded price, Claude estimates a
//      typical grocery price for the user's ZIP code (regional cost of living,
//      typical store mix). Clearly labeled as an estimate in the UI.
//
// No web scraping: retailer sites are hostile to it and break constantly.
// Estimates are cached per (item, ZIP) so repeat lookups are instant.
import { stores, readJSON, writeJSON, listAll } from './blobs.js'
import { claudeJSON, hasClaude } from './claude.js'

const EST_TTL_MS = 30 * 24 * 60 * 60 * 1000 // estimates are stable ~a month

export function normTerm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(oz|lb|lbs|g|kg|ml|l|ct|count|pack|cup|cups|tbsp|tsp|clove|cloves|can|cans|pkg|bag|box)\b/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(fresh|large|small|medium|boneless|skinless|organic|ground|chopped|diced|sliced|whole|raw)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s) {
  return new Set(normTerm(s).split(' ').filter((w) => w.length > 2))
}

// Token-overlap similarity for matching an ingredient to a recorded price.
export function similarity(a, b) {
  const A = tokens(a), B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / Math.min(A.size, B.size)
}

// --- 1. Recorded prices -----------------------------------------------------
// Returns { prices: [{store, price, date, source:'recorded'}], best } for an item.
export function priceFromDB(name, priceRecords, preferredStores = []) {
  const matches = priceRecords
    .map((r) => ({ r, score: similarity(name, r.name) }))
    .filter((m) => m.score >= 0.5)
  if (!matches.length) return { prices: [], best: null }

  // Most recent price per store.
  const byStore = {}
  for (const { r } of matches) {
    const prev = byStore[r.store]
    if (!prev || (r.date || '') > (prev.date || '')) {
      byStore[r.store] = {
        store: r.store,
        price: Number(r.unitPrice ?? r.price) || 0,
        date: r.date,
        source: 'recorded',
      }
    }
  }
  const prices = Object.values(byStore).filter((p) => p.price > 0).sort((a, b) => a.price - b.price)
  if (!prices.length) return { prices: [], best: null }

  // Prefer a store the user shops at when it's within 15% of the cheapest.
  let best = prices[0]
  if (preferredStores?.length) {
    const pref = prices.find((p) => preferredStores.some((s) => p.store.toLowerCase().includes(s.toLowerCase())))
    if (pref && pref.price <= best.price * 1.15) best = pref
  }
  return { prices, best }
}

export async function allPriceRecords() {
  return await listAll(stores.receiptItems())
}

// --- 2. AI estimates --------------------------------------------------------
const EST_SYSTEM = `You estimate typical U.S. grocery prices.
Given a ZIP code and a list of grocery items, return the typical current shelf price a shopper would pay for ONE standard grocery unit of each item in that area (a normal package/quantity — e.g. a dozen eggs, a 1 lb package of chicken breast, a single bell pepper, one loaf of bread).
Account for regional cost of living for that ZIP (urban vs rural, high vs low cost region).
Return ONLY JSON, no prose:
{ "items": [ { "name": string, "price": number, "unit": string } ] }
- "name" must exactly match the item name you were given.
- "price" is USD, a realistic mid-range price (not the cheapest or a premium organic brand).
- "unit" briefly names what the price buys (e.g. "dozen", "1 lb", "each", "16 oz box").
Include every item you were given.`

const cacheKey = (name, zip) => `est:${zip || 'us'}:${normTerm(name)}`

async function readEstimate(name, zip) {
  const rec = await readJSON(stores.priceCache(), cacheKey(name, zip))
  if (!rec || Date.now() - rec.ts > EST_TTL_MS) return null
  return rec.value
}

async function writeEstimate(name, zip, value) {
  await writeJSON(stores.priceCache(), cacheKey(name, zip), { ts: Date.now(), value })
}

// Estimate prices for a batch of item names at a ZIP. Cached per item+ZIP.
// Returns a Map of name -> { price, unit }.
export async function estimatePrices(names, zip, { force = false } = {}) {
  const out = new Map()
  const need = []

  for (const name of names) {
    if (!force) {
      const hit = await readEstimate(name, zip)
      if (hit) { out.set(name, hit); continue }
    }
    need.push(name)
  }
  if (!need.length || !hasClaude()) return out

  // One call for the whole batch — far cheaper and faster than one per item.
  const data = await claudeJSON({
    system: EST_SYSTEM,
    maxTokens: 2000,
    messages: [{
      role: 'user',
      content: `ZIP code: ${zip || 'average U.S. area'}\nItems:\n${need.map((n) => `- ${n}`).join('\n')}`,
    }],
  })

  for (const it of data.items || []) {
    const price = Number(it.price)
    if (!it.name || !isFinite(price) || price <= 0) continue
    // Match back to the exact name we asked for (Claude may lightly reword).
    const target = need.find((n) => n === it.name) ||
      need.find((n) => similarity(n, it.name) >= 0.6)
    if (!target) continue
    const value = { price: Math.round(price * 100) / 100, unit: it.unit || '' }
    out.set(target, value)
    await writeEstimate(target, zip, value)
  }
  return out
}
