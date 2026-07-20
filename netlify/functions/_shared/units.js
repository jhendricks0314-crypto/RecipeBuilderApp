// Unit math for pricing.
//
// The problem: the price database knows "ground beef = $5.99", but that's a price
// for SOME amount — usually a 1 lb package. If a recipe calls for 2.5 lbs, the
// real cost is ~$15, not $5.99. This module works out that multiplier.
//
// Approach: parse both the recipe's quantity ("2.5 lbs") and the price's unit
// ("1 lb", "16 oz box", "dozen") into a canonical {dimension, amount}. When both
// land in the same dimension we can divide to get a package count. When they
// don't (recipe wants "2 cloves", price is per bulb) we fall back to 1 package
// and say so, rather than inventing a number.

const WEIGHT = { // -> grams
  g: 1, gram: 1, grams: 1, gm: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
}
const VOLUME = { // -> millilitres
  ml: 1, millilitre: 1, milliliter: 1,
  l: 1000, liter: 1000, litre: 1000, liters: 1000, litres: 1000,
  tsp: 4.92892, teaspoon: 4.92892, teaspoons: 4.92892,
  tbsp: 14.7868, tablespoon: 14.7868, tablespoons: 14.7868,
  cup: 236.588, cups: 236.588,
  pint: 473.176, pints: 473.176, pt: 473.176,
  quart: 946.353, quarts: 946.353, qt: 946.353,
  gallon: 3785.41, gallons: 3785.41, gal: 3785.41,
  floz: 29.5735, 'fl oz': 29.5735, 'fluid ounce': 29.5735, 'fluid ounces': 29.5735,
}
const COUNT = { // -> individual items
  each: 1, ea: 1, count: 1, ct: 1, piece: 1, pieces: 1, whole: 1,
  dozen: 12, doz: 12,
  clove: 1, cloves: 1, slice: 1, slices: 1, stalk: 1, stalks: 1,
  can: 1, cans: 1, jar: 1, jars: 1, box: 1, boxes: 1, bag: 1, bags: 1,
  package: 1, packages: 1, pkg: 1, loaf: 1, loaves: 1, bunch: 1, bunches: 1,
  head: 1, heads: 1, bottle: 1, bottles: 1, container: 1, containers: 1,
}

// Fractions that show up in recipes: "1/2", "1 1/2", and the unicode ones.
const VULGAR = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }

function parseAmount(text) {
  let s = String(text || '').trim().toLowerCase()
  if (!s) return null

  // unicode fractions -> decimal
  for (const [glyph, val] of Object.entries(VULGAR)) {
    s = s.replace(new RegExp(glyph, 'g'), ` ${val} `)
  }

  // "1 1/2" (mixed) then "1/2" (plain)
  const mixed = s.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/)
  if (mixed) {
    const v = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
    s = s.replace(mixed[0], String(v))
  }
  const frac = s.match(/(\d+)\s*\/\s*(\d+)/)
  if (frac) s = s.replace(frac[0], String(Number(frac[1]) / Number(frac[2])))

  // A range ("2-3 lbs") -> take the midpoint, which is what a cook would buy.
  const range = s.match(/(\d*\.?\d+)\s*(?:-|–|to)\s*(\d*\.?\d+)/)
  if (range) s = s.replace(range[0], String((Number(range[1]) + Number(range[2])) / 2))

  const num = s.match(/(\d*\.?\d+)/)
  const amount = num ? Number(num[1]) : 1 // "a pinch of salt" -> 1
  const rest = (num ? s.slice(s.indexOf(num[1]) + num[1].length) : s).trim()
  return { amount, rest }
}

function findUnit(text) {
  const s = String(text || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
  const tables = [['weight', WEIGHT], ['volume', VOLUME], ['count', COUNT]]
  const hits = []
  for (const [dim, table] of tables) {
    for (const [word, factor] of Object.entries(table)) {
      const re = new RegExp(`(^|\\s)${word.replace(/\s/g, '\\s')}(\\s|$)`)
      const m = re.exec(s)
      if (m) hits.push({ dimension: dim, word, factor, at: m.index })
    }
  }
  if (!hits.length) return null
  // The unit that sits closest to the front wins — in "16 oz box" the amount
  // belongs to "oz", not "box". Ties go to the longer word so "fl oz" beats "oz".
  hits.sort((a, b) => (a.at - b.at) || (b.word.length - a.word.length))
  return hits[0]
}

// "2.5 lbs" -> { dimension:'weight', base: 1133.98 }  (base = grams / ml / items)
export function parseQuantity(text) {
  const parsed = parseAmount(text)
  if (!parsed) return null
  const unit = findUnit(parsed.rest || text)
  if (!unit) return { dimension: 'count', base: parsed.amount, amount: parsed.amount, unit: null }
  return {
    dimension: unit.dimension,
    base: parsed.amount * unit.factor,
    amount: parsed.amount,
    unit: unit.word,
  }
}

// What one "package" at the recorded/estimated price actually contains.
// "1 lb" -> 453g   ·   "16 oz box" -> 453g   ·   "dozen" -> 12   ·   "each" -> 1
export function parsePriceUnit(text) {
  if (!text) return { dimension: 'count', base: 1, unit: 'each' }
  const q = parseQuantity(text)
  if (!q || !q.base) return { dimension: 'count', base: 1, unit: 'each' }
  return q
}

/**
 * How many packages does this recipe need, and what does that cost?
 * Returns { multiplier, packages, total, basis, exact }
 *   exact:false means we couldn't reconcile the units and fell back to 1 package.
 */
export function priceForQuantity(recipeQty, unitPrice, priceUnitText) {
  const price = Number(unitPrice)
  if (!isFinite(price) || price <= 0) return null

  const need = parseQuantity(recipeQty)
  const per = parsePriceUnit(priceUnitText)

  // Same dimension: real math.
  if (need && per && need.dimension === per.dimension && per.base > 0) {
    const raw = need.base / per.base
    // You can't buy 0.4 of a package — but for weight/volume you effectively can
    // (deli counter, produce by weight), so only round up discrete counts.
    const packages = per.dimension === 'count' ? Math.max(1, Math.ceil(raw)) : raw
    return {
      multiplier: raw,
      packages: Math.round(packages * 100) / 100,
      total: Math.round(price * packages * 100) / 100,
      basis: `${need.amount}${need.unit ? ' ' + need.unit : ''} ÷ ${per.amount}${per.unit ? ' ' + per.unit : ''} per unit`,
      exact: true,
    }
  }

  // Different dimensions (recipe in cloves, price per bulb) — don't guess.
  return {
    multiplier: 1,
    packages: 1,
    total: Math.round(price * 100) / 100,
    basis: priceUnitText ? `price is per ${priceUnitText}` : 'price is per unit',
    exact: false,
  }
}
