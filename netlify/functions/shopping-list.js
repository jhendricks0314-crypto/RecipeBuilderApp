// Shopping lists.
//   POST /api/shopping-list/generate  { recipeIds:[], stores:[] }
//        -> aggregates ingredients across recipes, prices them against the
//           shared receipt database, and suggests the best store per item.
//   GET  /api/shopping-list?id=..     -> load a saved list
//   GET  /api/shopping-list           -> list saved lists for the profile
//   PUT  /api/shopping-list           { list } -> save edits (checkboxes, amounts, store choice)
//   DELETE /api/shopping-list?id=..   -> delete
//
// Pricing: ForkCast prices each ingredient from two sources and merges them —
//   1. the receipt-scan database (real prices people have paid), and
//   2. live scraped/API prices (see _shared/scrapers.js), when cached.
// Fresh live prices are pulled on demand via /api/scrape-prices; here we merge
// in whatever the scraper has already cached so generation stays fast.
import { getUser, ok, bad, unauth, forbidden } from './_shared/auth.js'
import { stores as S, readJSON, writeJSON, listAll, id } from './_shared/blobs.js'
import { cachedAggregate } from './_shared/scrapers.js'
import { logError } from './_shared/log.js'

// Normalize an ingredient/product name for fuzzy matching.
function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\b(\d+(\.\d+)?)\s*(oz|lb|lbs|g|kg|ml|l|cup|cups|tbsp|tsp|clove|cloves|can|cans|pkg)\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\b(fresh|large|small|medium|boneless|skinless|organic|ground|chopped|diced|sliced)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s) {
  return new Set(norm(s).split(' ').filter((w) => w.length > 2))
}

// Very small token-overlap score for matching ingredients to receipt items.
function similarity(a, b) {
  const A = tokens(a), B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / Math.min(A.size, B.size)
}

async function priceItem(name, receiptItems, preferredStores) {
  const matches = receiptItems
    .map((ri) => ({ ri, score: similarity(name, ri.name) }))
    .filter((m) => m.score >= 0.5)
  if (!matches.length) return { prices: [], best: null }

  // Latest price per store.
  const byStore = {}
  for (const { ri } of matches) {
    const prev = byStore[ri.store]
    if (!prev || (ri.date || '') > (prev.date || '')) {
      byStore[ri.store] = { store: ri.store, price: ri.unitPrice ?? ri.price, date: ri.date }
    }
  }
  let prices = Object.values(byStore).sort((a, b) => a.price - b.price)

  // Prefer the user's preferred stores when prices are close (within 15%).
  let best = prices[0]
  if (preferredStores?.length) {
    const pref = prices.find((p) => preferredStores.includes(p.store))
    if (pref && pref.price <= best.price * 1.15) best = pref
  }
  return { prices, best }
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  const url = new URL(req.url)
  const seg = url.pathname.split('/').filter(Boolean).pop()

  try {
    // ---- Generate a fresh list from selected recipes ----
    if (req.method === 'POST' && seg === 'generate') {
      const { recipeIds, stores: chosenStores } = await req.json()
      const ids = Array.isArray(recipeIds) ? recipeIds : []
      if (!ids.length) return bad('Select at least one recipe.')

      const profile = await readJSON(S.profiles(), user.profileId)
      const preferred = chosenStores?.length ? chosenStores : profile?.preferredStores || []
      const receiptItems = await listAll(S.receiptItems())

      // Aggregate ingredients across recipes (merge duplicates by normalized name).
      const agg = new Map()
      const recipeNames = []
      for (const rid of ids) {
        const r = await readJSON(S.recipes(), rid)
        if (!r || r.profileId !== user.profileId) continue
        recipeNames.push(r.name)
        for (const ing of r.ingredients || []) {
          if (ing.have) continue // already in the pantry — no need to buy
          const key = norm(ing.item)
          if (!key) continue
          if (!agg.has(key)) agg.set(key, { name: ing.item, quantities: [], fromRecipes: [] })
          const a = agg.get(key)
          if (ing.quantity) a.quantities.push(ing.quantity)
          a.fromRecipes.push(r.name)
        }
      }

      const items = []
      for (const a of agg.values()) {
        const { prices, best } = await priceItem(a.name, receiptItems, preferred)

        // Merge any live prices the scraper already cached for this item.
        const live = await cachedAggregate(a.name)
        const map = new Map()
        for (const p of prices) map.set(p.store, p)
        for (const p of live) {
          const prev = map.get(p.store)
          if (!prev || (p.date || '') >= (prev.date || '')) map.set(p.store, p)
        }
        const merged = [...map.values()].sort((x, y) => x.price - y.price)

        // Best across both sources, still preferring the user's stores when close.
        let chosen = merged[0] || null
        if (preferred?.length) {
          const pref = merged.find((p) => preferred.some((s) => p.store.toLowerCase().includes(s.toLowerCase())))
          if (pref && chosen && pref.price <= chosen.price * 1.15) chosen = pref
        }

        items.push({
          id: id('item_'),
          name: a.name,
          quantity: a.quantities.join(' + ') || '',
          fromRecipes: [...new Set(a.fromRecipes)],
          checked: false,
          removed: false,
          chosenStore: chosen?.store || null,
          bestPrice: chosen?.price ?? null,
          priceByStore: merged, // [{store, price, date, source}]
          hasReceiptData: merged.length > 0,
        })
      }
      items.sort((a, b) => a.name.localeCompare(b.name))

      const list = {
        id: id('list_'),
        profileId: user.profileId,
        title: recipeNames.length === 1 ? recipeNames[0] : `${recipeNames.length} recipes`,
        recipeIds: ids,
        recipeNames,
        stores: preferred,
        items,
        createdAt: new Date().toISOString(),
      }
      await writeJSON(S.shoppingLists(), list.id, list)
      return ok({ list })
    }

    // ---- Load / list ----
    if (req.method === 'GET') {
      const lid = url.searchParams.get('id')
      if (lid) {
        const l = await readJSON(S.shoppingLists(), lid)
        if (!l || l.profileId !== user.profileId) return forbidden()
        return ok({ list: l })
      }
      const all = await listAll(S.shoppingLists())
      const mine = all
        .filter((l) => l.profileId === user.profileId)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      return ok({ lists: mine })
    }

    // ---- Save edits ----
    if (req.method === 'PUT') {
      const { list } = await req.json()
      if (!list?.id) return bad('Missing list id.')
      const existing = await readJSON(S.shoppingLists(), list.id)
      if (!existing || existing.profileId !== user.profileId) return forbidden()
      const merged = { ...existing, ...list, profileId: user.profileId, updatedAt: new Date().toISOString() }
      await writeJSON(S.shoppingLists(), list.id, merged)
      return ok({ list: merged })
    }

    if (req.method === 'DELETE') {
      const lid = url.searchParams.get('id')
      const existing = await readJSON(S.shoppingLists(), lid)
      if (!existing || existing.profileId !== user.profileId) return forbidden()
      await S.shoppingLists().delete(lid)
      return ok({ deleted: true })
    }

    return bad('Unsupported request.', 405)
  } catch (error) {
    await logError({ req, user, action: `shopping-list:${seg || req.method}`, error })
    return bad('Something went wrong with the shopping list.', 500)
  }
}
