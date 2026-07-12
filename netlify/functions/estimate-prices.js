// POST /api/estimate-prices  { listId, zip?, force? }
// Fills in prices for a shopping list:
//   • Items with a recorded price (receipt / barcode / manual) keep it — always.
//   • Everything else gets an AI estimate for the profile's ZIP code.
// The ZIP is saved on the profile so it persists until the user changes it.
import { getUser, ok, bad, unauth, forbidden } from './_shared/auth.js'
import { stores as S, readJSON, writeJSON } from './_shared/blobs.js'
import { priceFromDB, estimatePrices, allPriceRecords } from './_shared/pricing.js'
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
      const { prices, best } = priceFromDB(it.name, records, preferred)
      if (best) {
        list.items[i] = {
          ...it,
          priceByStore: prices,
          bestPrice: best.price,
          chosenStore: prices.some((p) => p.store === it.chosenStore) ? it.chosenStore : best.store,
          priceSource: 'recorded',
          estimateUnit: null,
          pricedAt: new Date().toISOString(),
        }
      } else if (force || it.bestPrice == null || it.priceSource === 'estimated') {
        needEstimate.push({ it, i })
      }
    })

    // Pass 2: AI estimate for the rest (one batched call).
    let estimated = 0
    if (needEstimate.length && hasClaude()) {
      const est = await estimatePrices(needEstimate.map(({ it }) => it.name), useZip, { force })
      for (const { it, i } of needEstimate) {
        const e = est.get(it.name)
        if (!e) continue
        list.items[i] = {
          ...it,
          bestPrice: e.price,
          priceByStore: it.priceByStore?.length ? it.priceByStore : [],
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
      note: !hasClaude() && needEstimate.length
        ? 'Price estimates need ANTHROPIC_API_KEY. Recorded prices are still applied.'
        : null,
    })
  } catch (error) {
    await logError({ req, user, action: 'estimate-prices', error })
    return bad('Could not price this list. Please try again.', 500)
  }
}
