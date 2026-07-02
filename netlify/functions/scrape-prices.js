// POST /api/scrape-prices  { listId, zip?, force? }
// Refreshes live prices for the items on a shopping list using the scraper
// engine, merges them with existing (receipt + previously-scraped) prices, and
// saves the list. Bounded by a time budget so it stays within function limits —
// if not everything fits, it returns how many are left so the client can call
// again to continue.
//
// GET /api/scrape-prices/status  -> which price sources are configured.
import { getUser, ok, bad, unauth, forbidden, json } from './_shared/auth.js'
import { stores as S, readJSON, writeJSON } from './_shared/blobs.js'
import { getScrapedPrices, adaptersStatus, anyScraperEnabled } from './_shared/scrapers.js'
import { logError, logEvent } from './_shared/log.js'

const TIME_BUDGET_MS = 9000
const CONCURRENCY = 4

// Merge freshly scraped prices into an item's priceByStore (dedupe by store,
// prefer the newer entry), then recompute the best/chosen store.
function mergePrices(item, live) {
  const map = new Map()
  for (const p of item.priceByStore || []) map.set(p.store, p)
  for (const p of live) {
    const prev = map.get(p.store)
    if (!prev || (p.date || '') >= (prev.date || '')) map.set(p.store, p)
  }
  const priceByStore = [...map.values()].sort((a, b) => a.price - b.price)
  const best = priceByStore[0] || null
  const chosenStillThere = priceByStore.some((p) => p.store === item.chosenStore)
  return {
    ...item,
    priceByStore,
    hasReceiptData: priceByStore.length > 0,
    bestPrice: best?.price ?? item.bestPrice ?? null,
    chosenStore: chosenStillThere ? item.chosenStore : best?.store || null,
    pricedAt: new Date().toISOString(),
  }
}

// Small concurrency pool that respects a deadline.
async function runPool(items, worker, { concurrency, deadline }) {
  let idx = 0
  let done = 0
  const runNext = async () => {
    while (idx < items.length && Date.now() < deadline) {
      const i = idx++
      await worker(items[i], i)
      done++
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext))
  return done
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  const url = new URL(req.url)

  if (req.method === 'GET' && url.pathname.endsWith('/status')) {
    return ok({ enabled: anyScraperEnabled(), sources: adaptersStatus() })
  }

  if (req.method !== 'POST') return bad('Unsupported method.', 405)
  if (!user.profileId) return bad('Create a profile first.')
  if (!anyScraperEnabled()) {
    return json(
      { error: 'No live price source is configured. Add Kroger API keys or a SCRAPER_CONFIG entry.', sources: adaptersStatus() },
      { status: 503 }
    )
  }

  try {
    const { listId, zip, force } = await req.json()
    const list = await readJSON(S.shoppingLists(), listId)
    if (!list || list.profileId !== user.profileId) return forbidden()

    // Refresh items that are stale or unpriced first (unless forcing all).
    const targets = list.items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => force || !it.pricedAt || Date.now() - new Date(it.pricedAt).getTime() > 24 * 3600 * 1000)

    const deadline = Date.now() + TIME_BUDGET_MS
    let refreshed = 0
    await runPool(
      targets,
      async ({ it, i }) => {
        try {
          const live = await getScrapedPrices(it.name, { zip, force })
          if (live.length) { list.items[i] = mergePrices(it, live); refreshed++ }
          else list.items[i] = { ...it, pricedAt: new Date().toISOString() }
        } catch (e) {
          // Skip a single failing item; keep going.
          list.items[i] = { ...it, pricedAt: new Date().toISOString() }
        }
      },
      { concurrency: CONCURRENCY, deadline }
    )

    const remaining = list.items.filter((it) => !it.pricedAt || Date.now() - new Date(it.pricedAt).getTime() > 24 * 3600 * 1000).length
    list.updatedAt = new Date().toISOString()
    await writeJSON(S.shoppingLists(), list.id, list)
    await logEvent({ req, user, action: 'scrape-prices', message: `Refreshed ${refreshed} item(s), ${remaining} remaining` })

    return ok({ list, refreshed, remaining })
  } catch (error) {
    await logError({ req, user, action: 'scrape-prices', error })
    return bad('Price refresh failed. Please try again.', 500)
  }
}
