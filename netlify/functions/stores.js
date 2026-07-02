// GET /api/stores?lat=..&lng=..     OR    ?q=City, ST 72701
// Returns grocery stores ranked by distance (ascending).
// Uses Google Places if GOOGLE_PLACES_API_KEY is set; otherwise returns a
// built-in list of common chains with approximate distances so the flow works.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { logError } from './_shared/log.js'

const COMMON_CHAINS = [
  'Walmart Supercenter', 'Aldi', 'Harps Food Store', 'Dollar General Market',
  "Sam's Club", 'Kroger', 'Costco Wholesale', 'Target', 'Whole Foods Market', 'Trader Joe\'s',
]

function haversineMiles(a, b) {
  const R = 3958.8
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

async function placesNearby(lat, lng, key) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&rankby=distance&type=grocery_or_supermarket&key=${key}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Places error ${res.status}`)
  const data = await res.json()
  return (data.results || []).slice(0, 12).map((p) => ({
    name: p.name,
    address: p.vicinity || '',
    lat: p.geometry?.location?.lat,
    lng: p.geometry?.location?.lng,
    distanceMiles: p.geometry?.location
      ? Number(haversineMiles({ lat, lng }, p.geometry.location).toFixed(1))
      : null,
    source: 'places',
  }))
}

async function geocode(q, key) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`
  const res = await fetch(url)
  const data = await res.json()
  const loc = data.results?.[0]?.geometry?.location
  return loc || null
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  const url = new URL(req.url)
  const key = process.env.GOOGLE_PLACES_API_KEY

  try {
    let lat = parseFloat(url.searchParams.get('lat'))
    let lng = parseFloat(url.searchParams.get('lng'))
    const q = url.searchParams.get('q')

    if ((isNaN(lat) || isNaN(lng)) && q && key) {
      const loc = await geocode(q, key)
      if (loc) { lat = loc.lat; lng = loc.lng }
    }

    if (key && !isNaN(lat) && !isNaN(lng)) {
      const stores = await placesNearby(lat, lng, key)
      return ok({ stores, source: 'places' })
    }

    // Fallback: synthesize plausible ascending distances so the UI works
    // end-to-end without a Places key. These are clearly marked as estimates.
    const stores = COMMON_CHAINS.map((name, i) => ({
      name,
      address: q ? `Near ${q}` : 'Near you',
      distanceMiles: Number((1.2 + i * 1.35).toFixed(1)),
      source: 'builtin',
    }))
    return ok({
      stores,
      source: 'builtin',
      note: 'Approximate list — add GOOGLE_PLACES_API_KEY for real nearby stores.',
    })
  } catch (error) {
    await logError({ req, user, action: 'stores-lookup', error })
    return bad('Could not look up stores.', 500)
  }
}
