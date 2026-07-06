// ForkCast price scraper engine.
//
// Fetches live grocery prices from multiple sources behind one interface, with
// aggressive caching (Netlify Blobs) so we stay polite and fast. Built for
// private/personal use.
//
// Sources, in order of reliability:
//   1. Kroger adapter — the official Kroger Public API (free personal creds).
//      Covers all Kroger banners (Kroger, Fred Meyer, Ralphs, King Soopers,
//      Harris Teeter, Fry's, Smith's, QFC, Dillons, etc.). Rock solid.
//   2. Configurable HTML adapters — driven by the SCRAPER_CONFIG env var, so you
//      can add any server-rendered store with CSS selectors, no code changes.
//   3. Headless render hook — set SCRAPER_BROWSER_URL to a browserless/Playwright
//      endpoint and JS-heavy sites (Walmart, Target, etc.) get rendered before
//      parsing. Without it, those sites usually return an empty JS shell.
//
// Everything is cached per normalized term for 24h. Results are always merged
// with the receipt database by the shopping-list function.
import * as cheerio from 'cheerio'
import { stores, readJSON, writeJSON } from './blobs.js'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TTL_MS = 24 * 60 * 60 * 1000 // 24h price cache
const AGG_TTL_MS = 7 * 24 * 60 * 60 * 1000 // keep aggregate merge data a week

// --- term / price helpers ---------------------------------------------------
export function normTerm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(oz|lb|lbs|g|kg|ml|l|ct|count|pack|cup|cups|tbsp|tsp|clove|cloves|can|cans|pkg|bag|box)\b/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(fresh|large|small|medium|boneless|skinless|organic|ground|chopped|diced|sliced|whole|raw)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePrice(text) {
  if (text == null) return null
  const m = String(text).replace(/[, ]/g, '').match(/\$?(\d+\.\d{1,2}|\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return isFinite(n) && n > 0 && n < 1000 ? n : null
}

// --- cache ------------------------------------------------------------------
async function cacheGet(key, ttl = TTL_MS) {
  const rec = await readJSON(stores.priceCache(), key)
  if (!rec) return null
  if (Date.now() - rec.ts > ttl) return null
  return rec.value
}
async function cacheSet(key, value) {
  await writeJSON(stores.priceCache(), key, { ts: Date.now(), value })
  return value
}

// --- fetch (optionally via a headless-render proxy) -------------------------
// Works with two kinds of renderer:
//   • Browserless (cloud or self-hosted): POST /content?token=... { url }
//     returns rendered HTML. For bot-protected sites, `unblock:true` uses the
//     /unblock endpoint (bypasses many anti-bot walls) and reads back { content }.
//   • A custom Playwright/Puppeteer service: POST { url } returns JSON { html }.
// We auto-target the right endpoint from a base URL, attach a token from
// SCRAPER_BROWSER_TOKEN, and read the body as text once (JSON-parsing only if it
// looks like JSON) to avoid re-reading the stream.
async function fetchHTML(url, { render = false, unblock = false } = {}) {
  const proxy = process.env.SCRAPER_BROWSER_URL
  if ((render || unblock) && proxy) {
    const wantPath = unblock ? '/unblock' : '/content'
    let endpoint = proxy
    try {
      const u = new URL(proxy)
      if (u.pathname === '' || u.pathname === '/') { u.pathname = wantPath; endpoint = u.toString() }
      else if (unblock && /\/content$/.test(u.pathname)) { u.pathname = u.pathname.replace(/\/content$/, '/unblock'); endpoint = u.toString() }
    } catch { /* not a full URL; use as given */ }
    const token = process.env.SCRAPER_BROWSER_TOKEN
    if (token && !/[?&]token=/.test(endpoint)) {
      endpoint += (endpoint.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
    }
    const payload = unblock
      ? { url, content: true, browserWSEndpoint: false, cookies: false, screenshot: false }
      : { url }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`Render proxy ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const body = await res.text()
    if (body.trim().startsWith('{')) {
      try { const j = JSON.parse(body); return j.content || j.html || j.data || body } catch { return body }
    }
    return body // raw rendered HTML
  }
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' },
  })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return await res.text()
}

// ===========================================================================
// Adapter 1: Kroger official API
// ===========================================================================
const KROGER_BANNERS = [
  'kroger', 'fred meyer', 'ralphs', 'king soopers', 'harris teeter', 'frys', "fry's",
  'smiths', "smith's", 'qfc', 'dillons', 'city market', 'food 4 less', 'foods co',
  'pick n save', 'metro market', 'marianos', "mariano's", "baker's", 'gerbes',
  'jay c', 'pay less', 'owens', 'ruler', 'fred meyer',
]

const kroger = {
  id: 'kroger',
  label: 'Kroger',
  enabled: () => !!(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET),

  async token() {
    const cached = await cacheGet('kroger:token', 25 * 60 * 1000) // ~30m tokens
    if (cached) return cached
    const basic = Buffer.from(`${process.env.KROGER_CLIENT_ID}:${process.env.KROGER_CLIENT_SECRET}`).toString('base64')
    const res = await fetch('https://api.kroger.com/v1/connect/oauth2/token', {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=product.compact',
    })
    if (!res.ok) throw new Error(`Kroger token ${res.status}: ${await res.text()}`)
    const data = await res.json()
    await cacheSet('kroger:token', data.access_token)
    return data.access_token
  },

  async locationId(zip) {
    const z = zip || process.env.KROGER_DEFAULT_ZIP || ''
    const key = `kroger:loc:${z || 'default'}`
    const cached = await cacheGet(key, AGG_TTL_MS)
    if (cached) return cached
    const token = await this.token()
    const url = `https://api.kroger.com/v1/locations?filter.limit=1${z ? `&filter.zipCode.near=${encodeURIComponent(z)}` : ''}`
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
    if (!res.ok) throw new Error(`Kroger locations ${res.status}`)
    const data = await res.json()
    const loc = data.data?.[0]
    if (!loc) return null
    const info = { locationId: loc.locationId, name: loc.name, chain: loc.chain }
    await cacheSet(key, info)
    return info
  },

  async search(term, { zip } = {}) {
    const loc = await this.locationId(zip)
    if (!loc) return []
    const token = await this.token()
    const url = `https://api.kroger.com/v1/products?filter.term=${encodeURIComponent(term)}&filter.locationId=${loc.locationId}&filter.limit=8`
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
    if (!res.ok) throw new Error(`Kroger products ${res.status}`)
    const data = await res.json()
    const storeLabel = loc.chain ? `${cap(loc.chain)}${loc.name ? ` (${loc.name})` : ''}` : 'Kroger'
    const out = []
    for (const p of data.data || []) {
      const item = p.items?.[0]
      const price = item?.price?.promo || item?.price?.regular
      if (price) out.push({ store: storeLabel, price: Number(price), name: p.description, size: item?.size || '' })
    }
    return out
  },
}

// ===========================================================================
// Adapter 2+: configurable store adapters (env SCRAPER_CONFIG)
// ===========================================================================
// SCRAPER_CONFIG is a JSON array. Each entry needs an id, label, and searchUrl
// ({term} is substituted). Pick an extraction strategy with "extract":
//   • "css"      – CSS selectors: { item, name, price }         (simple sites)
//   • "jsonld"   – reads <script type=application/ld+json> Products (Aldi, etc.)
//   • "nextdata" – reads Next.js <script id=__NEXT_DATA__> JSON  (Walmart, etc.)
//   • "auto"     – tries __NEXT_DATA__, then JSON-LD (default when no selectors)
// For JS-heavy sites set "render": true (Browserless /content) or, for
// bot-protected sites, "unblock": true (Browserless /unblock). Both require
// SCRAPER_BROWSER_URL. See .env.example for ready-made Walmart/Aldi/DG entries.

function num(v) {
  if (v == null) return null
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null
  const m = String(v).replace(/[, ]/g, '').match(/(\d+(?:\.\d{1,2})?)/)
  const n = m ? Number(m[1]) : NaN
  return isFinite(n) && n > 0 && n < 100000 ? n : null
}

function getPath(obj, path) {
  if (!path) return undefined
  return path.split('.').reduce((o, k) => {
    if (o == null) return undefined
    const idx = k.match(/^(\w+)\[(\d+)\]$/)
    return idx ? o[idx[1]]?.[Number(idx[2])] : o[k]
  }, obj)
}

function nameOf(o) {
  const n = o && (o.name || o.title || o.productName || o.displayName)
  return typeof n === 'string' && n.trim().length > 1 ? n.trim() : null
}

function pickPrice(o) {
  if (!o || typeof o !== 'object') return null
  const unwrap = (c) => (c && typeof c === 'object' ? (c.price ?? c.amount ?? c.value ?? c.min) : c)
  const cands = [
    o.price, o.salePrice, o.currentPrice, o.finalPrice, o.minPrice, o.listPrice, o.unitPrice,
    o.currentPrice?.price, o.priceInfo?.currentPrice?.price, o.priceInfo?.linePrice,
    o.price?.regular, o.price?.promo, o.pricing?.current, o.offers?.price, o.offers?.lowPrice,
  ]
  for (const c of cands) { const n = num(unwrap(c)); if (n) return n }
  return null
}

// Recursively find product-like {name, price} objects anywhere in a JSON blob.
function deepFindProducts(node, out, depth = 0) {
  if (!node || depth > 9 || out.length > 80) return
  if (Array.isArray(node)) { for (const n of node) deepFindProducts(n, out, depth + 1); return }
  if (typeof node !== 'object') return
  const name = nameOf(node)
  const price = pickPrice(node)
  if (name && price) out.push({ name, price })
  for (const k in node) if (node[k] && typeof node[k] === 'object') deepFindProducts(node[k], out, depth + 1)
}

function readScriptJSON($, selector) {
  const el = $(selector).first()
  const raw = el.length ? (el.contents().text() || el.text()) : ''
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function extractJsonLd($) {
  const out = []
  $('script[type="application/ld+json"]').each((_, el) => {
    let data
    try { data = JSON.parse($(el).contents().text() || $(el).text()) } catch { return }
    const stack = [].concat(data)
    let guard = 0
    while (stack.length && guard++ < 500) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (node['@graph']) stack.push(...[].concat(node['@graph']))
      if (node.itemListElement) stack.push(...[].concat(node.itemListElement).map((x) => x.item || x))
      if ([].concat(node['@type'] || []).includes('Product')) {
        const name = nameOf(node)
        let price = null
        for (const of of [].concat(node.offers || [])) { const n = num(of.price ?? of.lowPrice); if (n) { price = n; break } }
        if (name && price) out.push({ name, price })
      }
    }
  })
  return out
}

// Extract [{name, price}] from a page using the configured strategy.
function extractProducts(html, cfg) {
  const $ = cheerio.load(html)
  const strat = cfg.extract || (cfg.selectors?.item ? 'css' : 'auto')

  if (strat === 'css' && cfg.selectors?.item) {
    const out = []
    $(cfg.selectors.item).each((_, el) => {
      const name = $(el).find(cfg.selectors.name).first().text().trim()
      const price = num($(el).find(cfg.selectors.price).first().text())
      if (name && price) out.push({ name, price })
    })
    return out.slice(0, 25)
  }

  if (strat === 'jsonld') return extractJsonLd($).slice(0, 25)

  if (strat === 'nextdata') {
    const data = readScriptJSON($, '#__NEXT_DATA__')
    if (!data) return []
    const out = []
    const items = cfg.itemsPath ? getPath(data, cfg.itemsPath) : null
    if (Array.isArray(items)) {
      for (const it of items) {
        const name = cfg.namePath ? getPath(it, cfg.namePath) : nameOf(it)
        const price = cfg.pricePath ? num(getPath(it, cfg.pricePath)) : pickPrice(it)
        if (name && price) out.push({ name: String(name).trim(), price })
      }
      if (out.length) return out.slice(0, 25)
    }
    deepFindProducts(data, out) // fallback: scan the whole blob
    return out.slice(0, 25)
  }

  // 'auto': Next.js data → JSON-LD
  const nd = readScriptJSON($, '#__NEXT_DATA__')
  if (nd) { const out = []; deepFindProducts(nd, out); if (out.length) return out.slice(0, 25) }
  const ld = extractJsonLd($)
  return ld.slice(0, 25)
}

function htmlAdapter(cfg) {
  const label = cfg.label || cfg.id
  return {
    id: cfg.id,
    label,
    // Render/unblock adapters need a browser endpoint; without it, stay disabled
    // rather than firing doomed plain requests at JS-heavy sites.
    enabled: () => (cfg.render || cfg.unblock ? !!process.env.SCRAPER_BROWSER_URL : true),
    async search(term) {
      const url = cfg.searchUrl.replace('{term}', encodeURIComponent(term))
      const html = await fetchHTML(url, { render: !!cfg.render, unblock: !!cfg.unblock })
      return extractProducts(html, cfg).map((p) => ({ store: label, price: p.price, name: p.name }))
    },
  }
}

function loadConfiguredAdapters() {
  try {
    const raw = process.env.SCRAPER_CONFIG
    if (!raw) return []
    const cfgs = JSON.parse(raw)
    return (Array.isArray(cfgs) ? cfgs : [])
      .filter((c) => c && c.id && c.searchUrl)
      .map(htmlAdapter)
  } catch {
    return []
  }
}

// --- adapter registry -------------------------------------------------------
export function allAdapters() {
  return [kroger, ...loadConfiguredAdapters()]
}
export function enabledAdapters() {
  return allAdapters().filter((a) => {
    try { return a.enabled ? a.enabled() : true } catch { return false }
  })
}
export function adaptersStatus() {
  return allAdapters().map((a) => ({ id: a.id, label: a.label, enabled: !!(a.enabled ? a.enabled() : true) }))
}

// Pick the store label most relevant to the caller's chosen stores, if any.
function bannerMatches(label, chosenStores) {
  if (!chosenStores?.length) return true
  const l = label.toLowerCase()
  return chosenStores.some((s) => l.includes(s.toLowerCase()) || s.toLowerCase().includes(l))
}

// ===========================================================================
// Public: get live prices for a single ingredient term (cached).
// ===========================================================================
export async function getScrapedPrices(term, { zip, force = false } = {}) {
  const key = `scrape:${normTerm(term)}:${zip || 'default'}`
  if (!force) {
    const hit = await cacheGet(key)
    if (hit) return hit
  }

  const adapters = enabledAdapters()
  const results = await Promise.allSettled(
    adapters.map((a) => a.search(term, { zip }))
  )

  // Per store, keep the price of the product that best matches the search term
  // (not just the cheapest item on the page — that might be an unrelated add-on).
  const termTokens = new Set(normTerm(term).split(' ').filter((w) => w.length > 2))
  const sim = (name) => {
    const B = new Set(normTerm(name).split(' ').filter((w) => w.length > 2))
    if (!termTokens.size || !B.size) return 0
    let inter = 0
    for (const t of termTokens) if (B.has(t)) inter++
    return inter / termTokens.size
  }

  const byStore = {}
  results.forEach((r) => {
    if (r.status !== 'fulfilled') return
    for (const hit of r.value || []) (byStore[hit.store] ||= []).push({ ...hit, sim: sim(hit.name || '') })
  })
  const prices = Object.entries(byStore).map(([store, hits]) => {
    const relevant = hits.filter((h) => h.sim >= 0.34)
    const pool = relevant.length ? relevant : hits
    pool.sort((a, b) => (b.sim - a.sim) || (a.price - b.price)) // most relevant, then cheapest
    const best = pool[0]
    return { store, price: best.price, matched: best.name, source: 'live', date: new Date().toISOString().slice(0, 10) }
  }).sort((a, b) => a.price - b.price)

  await cacheSet(key, prices)
  // Also keep a term-level aggregate for fast merges during list generation.
  await writeJSON(stores.priceCache(), `agg:${normTerm(term)}`, { ts: Date.now(), value: prices })
  return prices
}

// Fast, no-network read of the last aggregate for a term (used at generate time).
export async function cachedAggregate(term) {
  const rec = await readJSON(stores.priceCache(), `agg:${normTerm(term)}`)
  if (!rec || Date.now() - rec.ts > AGG_TTL_MS) return []
  return rec.value || []
}

export function anyScraperEnabled() {
  return enabledAdapters().length > 0
}

function cap(s) {
  return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase())
}
