// POST /api/estimate-prices  { listId, zip?, force? }
// Fills in prices for a shopping list:
//   • Items with a recorded price (receipt / barcode / manual) keep it — always.
//   • Everything else gets an AI estimate for the profile's ZIP code.
// The ZIP is saved on the profile so it persists until the user changes it.
import { getUser, ok, bad, unauth, forbidden } from './_shared/auth.js'
import { stores as S, readJSON, writeJSON } from './_shared/blobs.js'
import { priceFromDB, estimatePrices, allPriceRecords } from './_shared/pricing.js'
import { priceForQuantity } from './_shared/units.js'
import { ESTIMATE_STORE } from './_shared/pricing.js'
import { hasClaude } from './_shared/claude.js'
import { logError, logEvent } from './_shared/log.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  if (req.method !== 'POST') return bad('Unsupported method.', 405)

  try {
    const { listId, zip, force } = await req.json()
    const list = await readJSON(S.shoppingLists(), listId)
    if (!list || list.profileId !== user.profileId) return forbidden()

    const profile = await readJSON(S.profiles(), user.profileId)

    // Persist the ZIP on the profile whenever a new one is supplied.
    const useZip = (zip || '').trim() || profile?.zip || ''
    if (zip && zip.trim() && zip.trim() !== profile?.zip) {
      profile.zip = zip.trim()
      await writeJSON(S.profiles(), profile.id, profile)
    }

    const records = await allPriceRecords()
    const preferred = profile?.preferredStores || []

    // Pass 1: recorded prices win.
    const needEstimate = []
    list.items.forEach((it, i) => {
      // A price the user set or pinned by hand always wins over anything we compute.
      if (it.priceLocked) return

      const { prices, best } = priceFromDB(it.name, records, preferred)
      if (best) {
        // Scale EACH store's price to the amount needed, so switching stores
        // shows a correct line total rather than a bare per-unit price.
        const options = prices.map((p) => {
          const sc = priceForQuantity(it.quantity, p.price, p.unit)
          return { ...p, lineTotal: sc ? sc.total : p.price, packages: sc?.packages ?? null }
        })
        const keep = options.find((p) => p.store === it.chosenStore)
        const use = keep || options[0]
        const scaled = priceForQuantity(it.quantity, use.price, use.unit)
        list.items[i] = {
          ...it,
          priceByStore: options,
          unitPrice: use.price,
          priceUnit: use.unit || '',
          packages: scaled?.packages ?? null,
          bestPrice: scaled ? scaled.total : use.price,
          priceBasis: scaled?.basis || '',
          priceExact: scaled ? scaled.exact : null,
          chosenStore: use.store,
          priceSource: 'recorded',
          estimateUnit: null,
          pricedAt: new Date().toISOString(),
        }
      } else if (force || it.bestPrice == null) {
        // Only price what has NO price yet. An existing estimate is sticky —
        // re-running "Update prices" must not silently move numbers you've
        // already seen (or wipe one you set by hand). `force` is the opt-in.
        needEstimate.push({ it, i })
      }
    })

    // Pass 2: AI estimate for the rest (one batched call).
    // Wrapped so a failure here still leaves pass-1's recorded prices saved —
    // previously an estimate error threw away the whole update.
    let estimated = 0
    let estError = null
    if (needEstimate.length && hasClaude()) {
      let est = new Map()
      try {
        est = await estimatePrices(needEstimate.map(({ it }) => it.name), useZip, { force })
      } catch (e) {
        estError = e.message
      }
      for (const { it, i } of needEstimate) {
        const e = est.get(it.name)
        if (!e) continue
        // The estimate is for one standard grocery unit — scale it to the
        // quantity the recipes actually call for.
        const scaled = priceForQuantity(it.quantity, e.price, e.unit)
        // Estimates join the store list as their own entry, so an item can offer
        // "Aldi $3.19 / Walmart $3.49 / Estimated $3.29" side by side.
        const estOption = {
          store: ESTIMATE_STORE,
          price: e.price,
          unit: e.unit || '',
          date: new Date().toISOString().slice(0, 10),
          source: 'estimated',
          lineTotal: scaled ? scaled.total : e.price,
          packages: scaled?.packages ?? null,
        }
        const others = (it.priceByStore || []).filter((p) => p.store !== ESTIMATE_STORE)
        list.items[i] = {
          ...it,
          unitPrice: e.price,
          priceUnit: e.unit || '',
          packages: scaled?.packages ?? null,
          bestPrice: scaled ? scaled.total : e.price,
          priceBasis: scaled?.basis || '',
          priceExact: scaled ? scaled.exact : null,
          priceByStore: [...others, estOption].sort((a, b) => (a.lineTotal ?? a.price) - (b.lineTotal ?? b.price)),
          chosenStore: it.chosenStore || ESTIMATE_STORE,
          priceSource: 'estimated',
          estimateUnit: e.unit || '',
          pricedAt: new Date().toISOString(),
        }
        estimated++
      }
    }

    list.zip = useZip
    list.updatedAt = new Date().toISOString()
    await writeJSON(S.shoppingLists(), list.id, list)
    await logEvent({ req, user, action: 'estimate-prices', message: `${estimated} estimated for ${useZip || 'default area'}` })

    return ok({
      list,
      zip: useZip,
      estimated,
      note: estError
        ? `Some estimates failed (${estError}). Everything else was saved.`
        : !hasClaude() && needEstimate.length
          ? 'Price estimates need ANTHROPIC_API_KEY. Recorded prices are still applied.'
          : null,
    })
  } catch (error) {
    await logError({ req, user, action: 'estimate-prices', error })
    return bad('Could not price this list. Please try again.', 500)
  }
}
