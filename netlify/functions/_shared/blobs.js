// Thin wrapper over Netlify Blobs — this is RAIning Recipes's data store, so all app
// data lives "within Netlify" as the requirements ask. Each logical table is a
// named store; records are JSON blobs keyed by id.
import { getStore } from '@netlify/blobs'

export const stores = {
  profiles: () => getStore('profiles'),        // profileId -> Profile
  emailIndex: () => getStore('email-index'),   // email -> { profileId, role }
  recipes: () => getStore('recipes'),          // recipeId -> Recipe (owned)
  shoppingLists: () => getStore('shopping-lists'),
  receiptItems: () => getStore('receipt-items'), // shared price DB (food only)
  pantry: () => getStore('pantry'),            // profileId -> { items: [...] }
  priceCache: () => getStore('price-cache'),   // cached AI price estimates (TTL)
  listShares: () => getStore('list-shares'),   // token -> emailed shopping list share
  logs: () => getStore('logs'),                // logId -> LogEntry
}

export async function readJSON(store, key, fallback = null) {
  const val = await store.get(key, { type: 'json' })
  return val == null ? fallback : val
}

export async function writeJSON(store, key, value) {
  await store.set(key, JSON.stringify(value))
  return value
}

// List every record in a store (Blobs paginates; we flatten it).
export async function listAll(store) {
  const out = []
  let cursor
  do {
    const page = await store.list({ cursor })
    for (const b of page.blobs) {
      const val = await store.get(b.key, { type: 'json' })
      if (val != null) out.push(val)
    }
    cursor = page.cursor
  } while (cursor)
  return out
}

export function id(prefix = '') {
  const r = () => Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${r()}`
}
