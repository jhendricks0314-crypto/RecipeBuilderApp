// Formatting + a deterministic "recipe photo" generator.
//
// True photorealistic image generation needs a separate image model/API, which
// ForkCast leaves as a pluggable hook (see README → recipe images). In its
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
export const TIMES = [
  { key: 'quick', label: 'Quick' },
  { key: 'moderate', label: '30–45 min' },
  { key: 'none', label: 'No limit' },
]
export const AUDIENCES = ['Adults', 'Kids', 'Adults + Kids']
