// Shopping lists.
//   POST /api/shopping-list/generate  { recipeIds:[], stores:[] }
//        -> aggregates ingredients across recipes, prices them against the
//           shared receipt database, and suggests the best store per item.
//   GET  /api/shopping-list?id=..     -> load a saved list
//   GET  /api/shopping-list           -> list saved lists for the profile
//   PUT  /api/shopping-list           { list } -> save edits (checkboxes, amounts, store choice)
//   DELETE /api/shopping-list?id=..   -> delete
//
// Pricing: recorded prices (receipts / barcode / manual) always win. Anything
// with no recorded price gets an AI estimate for the profile's ZIP — pulled on
// demand via /api/estimate-prices.
//
// Pantry: ingredients you already have are marked and pre-removed from the buy
// list, and Claude suggests substitutions you could make from pantry contents
// (the user decides — nothing is applied automatically).
import { getUser, ok, bad, unauth, forbidden } from './_shared/auth.js'
import { stores as S, readJSON, writeJSON, listAll, id } from './_shared/blobs.js'
import { priceFromDB, allPriceRecords, similarity } from './_shared/pricing.js'
import { priceForQuantity } from './_shared/units.js'
import { claudeJSON, hasClaude } from './_shared/claude.js'
import { logError } from './_shared/log.js'

const SUB_SYSTEM = `You help a cook avoid buying things they can already make from what's in their pantry.
Given a shopping list and the cook's pantry contents, find items on the list that could be made from pantry ingredients instead of bought.
A suggestion is only valid if the pantry ALREADY contains essentially everything needed. Example: the list has "pancake mix" and the pantry has flour, eggs, milk, baking powder, and sugar -> suggest making pancakes from scratch.
Be conservative. Do not suggest a substitution if a key component is missing. Do not suggest swapping one purchase for another purchase.
Return ONLY JSON: { "substitutions": [ { "itemId": string, "makeFrom": [string], "note": string } ] }
- "itemId" must be one of the ids you were given.
- "makeFrom" lists the pantry items used.
- "note" is one short sentence telling the cook what they'd make instead (and any caveat).
Return an empty array if nothing qualifies.`

async function suggestSubstitutions(listItems, pantryItems) {
  if (!hasClaude() || !listItems.length || !pantryItems.length) return []
  try {
    const data = await claudeJSON({
      system: SUB_SYSTEM,
      maxTokens: 1500,
      messages: [{
        role: 'user',
        content:
          `Shopping list:\n${listItems.map((i) => `- [${i.id}] ${i.name}`).join('\n')}\n\n` +
          `Pantry:\n${pantryItems.map((p) => `- ${p.name}${p.quantity ? ` (${p.quantity})` : ''}`).join('\n')}`,
      }],
    })
    const byId = new Map(listItems.map((i) => [i.id, i.name]))
    return (data.substitutions || [])
      .filter((s) => byId.has(s.itemId) && Array.isArray(s.makeFrom) && s.makeFrom.length)
      .map((s) => ({
        itemId: s.itemId,
        itemName: byId.get(s.itemId),
        makeFrom: s.makeFrom,
        note: s.note || '',
        decision: null, // 'accepted' | 'declined' — set by the user
      }))
  } catch {
    return [] // a failed suggestion must never block the list
  }
}

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
      const priceRecords = await allPriceRecords()

      // What's already in the pantry?
      const pantryDoc = await readJSON(S.pantry(), user.profileId)
      const pantryItems = pantryDoc?.items || []
      const inPantry = (name) => pantryItems.find((p) => similarity(p.name, name) >= 0.6) || null

      // Aggregate ingredients across recipes (merge duplicates by normalized name).
      const agg = new Map()
      const recipeNames = []
      for (const rid of ids) {
        const r = await readJSON(S.recipes(), rid)
        if (!r || r.profileId !== user.profileId) continue
        recipeNames.push(r.name)
        for (const ing of r.ingredients || []) {
          const key = norm(ing.item)
          if (!key) continue
          if (!agg.has(key)) agg.set(key, { name: ing.item, quantities: [], fromRecipes: [], have: !!ing.have })
          const a = agg.get(key)
          if (ing.quantity) a.quantities.push(ing.quantity)
          a.fromRecipes.push(r.name)
          if (ing.have) a.have = true
        }
      }

      const items = []
      for (const a of agg.values()) {
        // Skip only when the pantry truly has it (or the recipe flagged it).
        const pantryHit = inPantry(a.name)
        const owned = a.have || !!pantryHit

        const { prices, best } = priceFromDB(a.name, priceRecords, preferred)

        // A recorded price is for ONE unit (e.g. $5.99 per lb). Scale it to the
        // amount this list actually needs, so 2.5 lbs of beef reads ~$15, not $5.99.
        const qtyText = a.quantities.join(' + ')
        const scaled = best ? priceForQuantity(qtyText, best.price, best.unit) : null

        items.push({
          id: id('item_'),
          name: a.name,
          quantity: a.quantities.join(' + ') || '',
          fromRecipes: [...new Set(a.fromRecipes)],
          checked: false,
          removed: owned,                       // already have it -> off the buy list
          inPantry: owned,
          pantryNote: pantryHit ? `You have ${pantryHit.name} in your pantry` : (owned ? 'Already on hand' : null),
          chosenStore: best?.store || null,
          unitPrice: best?.price ?? null,       // price for ONE unit
          priceUnit: best?.unit || '',          // what that unit is ("1 lb")
          packages: scaled?.packages ?? null,   // how many units this list needs
          bestPrice: scaled ? scaled.total : (best?.price ?? null), // line total
          priceBasis: scaled?.basis || '',
          priceExact: scaled ? scaled.exact : null,
          priceByStore: prices,                 // recorded prices only; estimates fill in later
          priceSource: best ? 'recorded' : null,
          estimateUnit: null,
        })
      }
      items.sort((a, b) => a.name.localeCompare(b.name))

      // Suggest pantry-based substitutions (e.g. pancake mix -> flour/eggs/milk
      // you already have). The user decides; nothing is applied automatically.
      const substitutions = await suggestSubstitutions(
        items.filter((i) => !i.inPantry).map((i) => ({ id: i.id, name: i.name })),
        pantryItems
      )

      const list = {
        id: id('list_'),
        profileId: user.profileId,
        title: recipeNames.length === 1 ? recipeNames[0] : `${recipeNames.length} recipes`,
        recipeIds: ids,
        recipeNames,
        stores: preferred,
        zip: profile?.zip || '',
        items,
        substitutions,      // [{ itemId, itemName, makeFrom:[], note }] — pending user's call
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
