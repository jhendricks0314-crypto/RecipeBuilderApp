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


// Build a name that actually distinguishes one list from another.
function defaultTitle(names) {
  if (!names?.length) return 'Shopping list'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} + ${names[1]}`
  return `${names[0]} + ${names.length - 1} more`
}

// Aggregate the ingredients of a set of recipes into priced line items.
// Shared by list creation and by changing which recipes a list covers, so the
// two can't produce different results.
async function buildItems({ ids, user, priceRecords, preferred, pantryItems, inPantry }) {
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
    const pantryHit = inPantry(a.name)
    const owned = a.have || !!pantryHit
    const { prices, best } = priceFromDB(a.name, priceRecords, preferred)
    const qtyText = a.quantities.join(' + ')
    const scaled = best ? priceForQuantity(qtyText, best.price, best.unit) : null

    items.push({
      id: id('item_'),
      name: a.name,
      quantity: qtyText || '',
      fromRecipes: [...new Set(a.fromRecipes)],
      source: 'recipe',
      checked: false,
      removed: owned,
      inPantry: owned,
      pantryNote: pantryHit ? `You have ${pantryHit.name} in your pantry` : (owned ? 'Already on hand' : null),
      chosenStore: best?.store || null,
      unitPrice: best?.price ?? null,
      priceUnit: best?.unit || '',
      packages: scaled?.packages ?? null,
      bestPrice: scaled ? scaled.total : (best?.price ?? null),
      priceBasis: scaled?.basis || '',
      priceExact: scaled ? scaled.exact : null,
      priceByStore: prices,
      priceSource: best ? 'recorded' : null,
      estimateUnit: null,
    })
  }
  items.sort((a, b) => a.name.localeCompare(b.name))

  const substitutions = await suggestSubstitutions(
    items.filter((i) => !i.inPantry).map((i) => ({ id: i.id, name: i.name })),
    pantryItems
  )
  return { items, recipeNames, substitutions }
}

// Re-aggregate a list after its recipes change, WITHOUT losing the cook's work:
// anything ticked off, priced by hand, or added manually survives.
function mergeItems(existing, rebuilt) {
  const byName = new Map(existing.map((i) => [norm(i.name), i]))
  const merged = rebuilt.map((next) => {
    const prev = byName.get(norm(next.name))
    if (!prev) return next
    return {
      ...next,
      id: prev.id,
      checked: prev.checked,
      removed: prev.removed,
      // A price the cook set or a store they chose always wins.
      ...(prev.priceLocked
        ? {
            priceLocked: true,
            chosenStore: prev.chosenStore,
            bestPrice: prev.bestPrice,
            unitPrice: prev.unitPrice,
            priceUnit: prev.priceUnit,
            packages: prev.packages,
            priceSource: prev.priceSource,
          }
        : {}),
      ...(prev.edited ? { name: prev.name, quantity: prev.quantity, edited: true } : {}),
    }
  })
  // Manually added lines belong to the cook, not to any recipe — always keep
  // them. Skip any whose name a recipe now supplies too, or adding a recipe that
  // happens to use the same ingredient would leave two identical lines.
  const rebuiltNames = new Set(merged.map((i) => norm(i.name)))
  const manual = existing.filter((i) => i.source === 'manual' && !rebuiltNames.has(norm(i.name)))
  return [...merged, ...manual].sort((a, b) => a.name.localeCompare(b.name))
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
      const { recipeIds, stores: chosenStores, title } = await req.json()
      const ids = Array.isArray(recipeIds) ? recipeIds : []
      if (!ids.length) return bad('Select at least one recipe.')

      const profile = await readJSON(S.profiles(), user.profileId)
      const preferred = chosenStores?.length ? chosenStores : profile?.preferredStores || []
      const priceRecords = await allPriceRecords()

      // What's already in the pantry?
      const pantryDoc = await readJSON(S.pantry(), user.profileId)
      const pantryItems = pantryDoc?.items || []
      const inPantry = (name) => pantryItems.find((p) => similarity(p.name, name) >= 0.6) || null

      const built = await buildItems({ ids, user, priceRecords, preferred, pantryItems, inPantry })

      const list = {
        id: id('list_'),
        profileId: user.profileId,
        // A name the cook chooses. Defaulting every multi-recipe list to
        // "2 recipes" made them impossible to tell apart in the list picker.
        title: (title || '').trim() || defaultTitle(built.recipeNames),
        recipeIds: ids,
        recipeNames: built.recipeNames,
        stores: preferred,
        zip: profile?.zip || '',
        items: built.items,
        substitutions: built.substitutions,
        createdAt: new Date().toISOString(),
      }
      await writeJSON(S.shoppingLists(), list.id, list)
      return ok({ list })
    }

    // ---- Change which recipes a list covers, keeping the cook's work ----
    if (req.method === 'PUT' && seg === 'recipes') {
      const { listId, recipeIds } = await req.json()
      const list = await readJSON(S.shoppingLists(), listId)
      if (!list || list.profileId !== user.profileId) return forbidden()

      const nextIds = Array.isArray(recipeIds) ? recipeIds : []
      const profile2 = await readJSON(S.profiles(), user.profileId)
      const pantryDoc2 = await readJSON(S.pantry(), user.profileId)
      const pantryItems2 = pantryDoc2?.items || []
      const inPantry2 = (name) => pantryItems2.find((p) => similarity(p.name, name) >= 0.6) || null
      const records2 = await allPriceRecords()

      const rebuilt = await buildItems({
        ids: nextIds,
        user,
        priceRecords: records2,
        preferred: profile2?.preferredStores || [],
        pantryItems: pantryItems2,
        inPantry: inPantry2,
      })

      list.recipeIds = nextIds
      list.recipeNames = rebuilt.recipeNames
      list.items = mergeItems(list.items || [], rebuilt.items)
      list.substitutions = rebuilt.substitutions
      list.updatedAt = new Date().toISOString()
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
