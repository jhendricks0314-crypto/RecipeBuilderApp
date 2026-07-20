// Formatting + a deterministic "recipe photo" generator.
//
// True photorealistic image generation needs a separate image model/API, which
// RAIning Recipes leaves as a pluggable hook (see README → recipe images). In its
// place, every recipe gets a distinctive, appetizing generated icon derived
// from its name + cuisine, so each card is visually unique and stable.

export function money(n) {
  if (n == null || isNaN(n)) return '—'
  return '$' + Number(n).toFixed(2)
}

export function fromNow(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return d.toLocaleDateString()
}

export function stamp(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return Math.abs(h)
}

// A small vocabulary of food glyphs keyed loosely by cuisine/keywords.
const GLYPHS = [
  { re: /pasta|italian|spaghetti|pizza|lasagna/i, g: '🍝' },
  { re: /taco|mexican|burrito|quesadilla|enchilada/i, g: '🌮' },
  { re: /sushi|japanese|ramen|noodle|teriyaki/i, g: '🍜' },
  { re: /burger|american|bbq|barbecue|grill/i, g: '🍔' },
  { re: /salad|veg|greens|bowl/i, g: '🥗' },
  { re: /chicken|poultry|wing/i, g: '🍗' },
  { re: /steak|beef|roast/i, g: '🥩' },
  { re: /fish|salmon|seafood|shrimp/i, g: '🐟' },
  { re: /soup|stew|chili/i, g: '🍲' },
  { re: /curry|indian|thai/i, g: '🍛' },
  { re: /breakfast|egg|pancake|waffle/i, g: '🍳' },
  { re: /dessert|cake|sweet|pie|cookie/i, g: '🧁' },
  { re: /bread|bake|sandwich/i, g: '🥪' },
  { re: /rice|fried rice|chinese/i, g: '🍚' },
]

const PALETTES = [
  ['#e0a82e', '#b9861a'], ['#3b7a57', '#245c40'], ['#d6482b', '#a5351d'],
  ['#3d6b8a', '#2a4d66'], ['#8a5a3d', '#6a4229'], ['#7a5a8a', '#573f66'],
]

export function recipeGlyph(recipe) {
  const text = `${recipe?.name || ''} ${recipe?.cuisine || ''}`
  const found = GLYPHS.find((x) => x.re.test(text))
  return found ? found.g : '🍽️'
}

// Returns an inline SVG string used as the recipe "photo".
export function recipeIconSVG(recipe) {
  const seed = hash((recipe?.name || 'dish') + (recipe?.cuisine || ''))
  const [c1, c2] = PALETTES[seed % PALETTES.length]
  const angle = (seed % 90) + 20
  const glyph = recipeGlyph(recipe)
  const dots = Array.from({ length: 6 }).map((_, i) => {
    const x = ((seed >> (i * 3)) % 100)
    const y = ((seed >> (i * 2 + 1)) % 100)
    const r = 3 + ((seed >> i) % 5)
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,0.10)"/>`
  }).join('')
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g${seed}" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${angle} .5 .5)">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="100" height="100" fill="url(#g${seed})"/>${dots}
    <text x="50" y="50" font-size="46" text-anchor="middle" dominant-baseline="central">${glyph}</text>
  </svg>`
}

export const CUISINES = [
  'Random', 'American', 'Italian', 'Mexican', 'Chinese', 'Japanese', 'Thai', 'Indian',
  'Mediterranean', 'French', 'Greek', 'Korean', 'Vietnamese', 'Spanish', 'Middle Eastern',
  'Southern / Soul', 'Cajun', 'BBQ', 'Vegetarian', 'Vegan',
]
export const TOOLS = ['Grill', 'Pellet Smoker', 'Oven', 'Stove Top', 'Nothing']

// Cooking tools the household starts with — they can add their own.
export const DEFAULT_TOOLS = ['Stove Top', 'Oven', 'Smoker', 'Grill']

// Where food actually lives. Every pantry item belongs to exactly one.
export const PANTRY_LOCATIONS = ['Pantry', 'Refrigerator', 'Freezer', 'Deep Freeze']
export function locationEmoji(loc) {
  return { 'Pantry': '🥫', 'Refrigerator': '🧊', 'Freezer': '❄️', 'Deep Freeze': '🗄️' }[loc] || '🥫'
}
export function normalizeLocation(v) {
  const s = String(v || '').trim()
  const hit = PANTRY_LOCATIONS.find((l) => l.toLowerCase() === s.toLowerCase())
  return hit || 'Pantry'
}

// Nutrition targets (things to keep low / high).
export const NUTRITION_GOALS = [
  'Low calorie', 'Low sodium', 'Low cholesterol', 'Low saturated fat',
  'Low sugar', 'Low carb', 'High protein', 'High fiber', 'Heart healthy',
]

// Popular named diets.
export const DIET_PLANS = [
  'Keto', 'Atkins', 'Paleo', 'Whole30', 'Mediterranean', 'DASH',
  'Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free',
  'Low-FODMAP', 'Diabetic-friendly', 'Anti-inflammatory', 'Carnivore',
]
export const TIMES = [
  { key: 'quick', label: 'Quick' },
  { key: 'moderate', label: '30–45 min' },
  { key: 'none', label: 'No limit' },
]
export const AUDIENCES = ['Adults', 'Kids', 'Adults + Kids']

// Pantry categories, in the order they should appear in the grouped list.
export const PANTRY_CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry & Dry Goods',
  'Canned & Jarred', 'Condiments & Sauces', 'Spices & Baking', 'Frozen',
  'Snacks', 'Beverages', 'Other',
]

const CATEGORY_EMOJI = {
  'Produce': '🥬', 'Meat & Seafood': '🥩', 'Dairy & Eggs': '🥚', 'Bakery': '🍞',
  'Pantry & Dry Goods': '🌾', 'Canned & Jarred': '🥫', 'Condiments & Sauces': '🧂',
  'Spices & Baking': '🌶️', 'Frozen': '🧊', 'Snacks': '🍿', 'Beverages': '🥤', 'Other': '📦',
}
export const categoryEmoji = (c) => CATEGORY_EMOJI[c] || '📦'

// Map any free-form category text to one of the canonical buckets (mirrors the
// server so the UI can categorize instantly for manual entries).
export function normalizeCategory(s) {
  const t = (s || '').toLowerCase()
  if (/(produce|fruit|vegetable|veggie|greens|herb\b)/.test(t)) return 'Produce'
  if (/(meat|seafood|fish|poultry|chicken|beef|pork|deli)/.test(t)) return 'Meat & Seafood'
  if (/(dairy|milk|cheese|yogurt|egg|butter|cream)/.test(t)) return 'Dairy & Eggs'
  if (/(bakery|bread|bagel|tortilla|bun|roll|pastr)/.test(t)) return 'Bakery'
  if (/(frozen)/.test(t)) return 'Frozen'
  if (/(\bcan\b|jar|soup|beans|broth)/.test(t)) return 'Canned & Jarred'
  if (/(condiment|sauce|ketchup|mustard|mayo|dressing|\boil\b|vinegar|syrup|honey)/.test(t)) return 'Condiments & Sauces'
  if (/(spice|season|baking|flour|sugar|yeast|extract|\bsalt\b|pepper)/.test(t)) return 'Spices & Baking'
  if (/(snack|chip|cracker|cookie|candy|nuts|\bbar\b|popcorn)/.test(t)) return 'Snacks'
  if (/(beverage|drink|juice|soda|coffee|tea|water|wine|beer)/.test(t)) return 'Beverages'
  if (/(pasta|spaghetti|macaroni|penne|ramen|noodle|rice|grain|cereal|dry goods|pantry|oats|lentil|quinoa|couscous|barley)/.test(t)) return 'Pantry & Dry Goods'
  return PANTRY_CATEGORIES.includes(s) ? s : 'Other'
}

// --- Scaling a recipe to a different number of people -----------------------
// Multiplies the numeric part of a quantity while leaving the unit alone.
// Handles "2", "2.5 lbs", "1 1/2 cups", "½ tsp", "2-3 cloves", and text-only
// amounts like "a pinch" (which stay as they are — a pinch doesn't double).

const VULGAR = { '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }

// Turn an awkward decimal back into a cook-friendly fraction.
function pretty(n) {
  if (!isFinite(n) || n <= 0) return ''
  const rounded = Math.round(n * 100) / 100
  const whole = Math.floor(rounded)
  const frac = rounded - whole
  const table = [[1/8,'1/8'], [1/4,'1/4'], [1/3,'1/3'], [1/2,'1/2'], [2/3,'2/3'], [3/4,'3/4'], [7/8,'7/8']]
  for (const [val, label] of table) {
    if (Math.abs(frac - val) < 0.04) return whole ? `${whole} ${label}` : label
  }
  if (frac < 0.04) return String(whole)
  // Not near a nice fraction — one decimal reads better than two.
  return String(Math.round(rounded * 10) / 10)
}

export function scaleQuantity(text, factor) {
  const raw = String(text ?? '').trim()
  if (!raw || !isFinite(factor) || factor <= 0) return raw
  if (Math.abs(factor - 1) < 0.001) return raw

  let s = raw
  for (const [glyph, val] of Object.entries(VULGAR)) s = s.split(glyph).join(` ${val} `)

  // Range ("2-3 lbs"): scale both ends so it stays a range.
  const range = s.match(/(\d*\.?\d+)\s*(?:-|–|to)\s*(\d*\.?\d+)/)
  if (range) {
    const lo = pretty(Number(range[1]) * factor)
    const hi = pretty(Number(range[2]) * factor)
    return s.replace(range[0], `${lo}-${hi}`).replace(/\s+/g, ' ').trim()
  }

  // Mixed number ("1 1/2 cups")
  const mixed = s.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/)
  if (mixed) {
    const val = (Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])) * factor
    return s.replace(mixed[0], pretty(val)).replace(/\s+/g, ' ').trim()
  }

  // Plain fraction ("1/2 cup")
  const frac = s.match(/(\d+)\s*\/\s*(\d+)/)
  if (frac) {
    const val = (Number(frac[1]) / Number(frac[2])) * factor
    return s.replace(frac[0], pretty(val)).replace(/\s+/g, ' ').trim()
  }

  // Plain number
  const num = s.match(/(\d*\.?\d+)/)
  if (num) {
    return s.replace(num[0], pretty(Number(num[1]) * factor)).replace(/\s+/g, ' ').trim()
  }

  // No number at all ("a pinch", "to taste") — leave it be.
  return raw
}

// Rewrite a whole recipe for a new serving count, including the per-step amounts.
export function scaleRecipe(recipe, newServings) {
  const from = Number(recipe.servings) || 1
  const to = Number(newServings) || from
  const factor = to / from
  if (!isFinite(factor) || factor <= 0 || factor === 1) return { ...recipe, servings: to }

  return {
    ...recipe,
    servings: to,
    ingredients: (recipe.ingredients || []).map((i) => ({ ...i, quantity: scaleQuantity(i.quantity, factor) })),
    steps: (recipe.steps || []).map((s) => ({
      ...s,
      uses: (s.uses || []).map((u) => ({ ...u, amount: scaleQuantity(u.amount, factor) })),
    })),
    scaledFrom: recipe.scaledFrom || { servings: from },
  }
}
