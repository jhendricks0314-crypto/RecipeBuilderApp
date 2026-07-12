// Tiny fetch wrapper. All calls hit /api/* (redirected to Netlify functions),
// carry cookies for the session, and throw a friendly Error on failure.
async function request(path, { method = 'GET', body, params } = {}) {
  let url = `/api/${path}`
  if (params) {
    const q = new URLSearchParams(params).toString()
    if (q) url += `?${q}`
  }
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  me: () => request('me'),
  logout: () => request('me/logout', { method: 'POST' }),

  createProfile: (body) => request('profile', { method: 'POST', body }),
  updateProfile: (body) => request('profile', { method: 'PUT', body }),
  deleteProfile: () => request('profile', { method: 'DELETE' }),
  addMember: (email) => request('profile/members', { method: 'POST', body: { email } }),
  removeMember: (email) => request('profile/members', { method: 'DELETE', body: { email } }),

  generateRecipes: (body) => request('generate-recipes', { method: 'POST', body }),
  // Revise ONE recipe by continuing its own conversation thread.
  reviseRecipe: (recipe, command) =>
    request('generate-recipes', { method: 'POST', body: { revise: true, recipe, command } }),
  validateCommand: (command) => request('validate-command', { method: 'POST', body: { command } }),

  listRecipes: () => request('recipes'),
  getRecipe: (id) => request('recipes', { params: { id } }),
  saveRecipes: (recipes) => request('recipes', { method: 'POST', body: { recipes } }),
  updateRecipe: (recipe) => request('recipes', { method: 'PUT', body: { recipe } }),
  deleteRecipe: (id) => request('recipes', { method: 'DELETE', params: { id } }),
  shareRecipe: (recipeIds, email) => request('share-recipe', { method: 'POST', body: { recipeIds, email } }),

  stores: (params) => request('stores', { params }),
  generateList: (recipeIds, stores) =>
    request('shopping-list/generate', { method: 'POST', body: { recipeIds, stores } }),
  listShoppingLists: () => request('shopping-list'),
  getShoppingList: (id) => request('shopping-list', { params: { id } }),
  updateShoppingList: (list) => request('shopping-list', { method: 'PUT', body: { list } }),
  deleteShoppingList: (id) => request('shopping-list', { method: 'DELETE', params: { id } }),

  estimatePrices: (listId, zip, force) => request('estimate-prices', { method: 'POST', body: { listId, zip, force } }),

  // Price database (recorded prices: manual, barcode, receipt)
  listPrices: (q) => request('prices', { params: q ? { q } : undefined }),
  addPrice: (body) => request('prices', { method: 'POST', body }),
  deletePrice: (id) => request('prices', { method: 'DELETE', params: { id } }),

  parseReceipt: (body) => request('receipts/parse', { method: 'POST', body }),
  commitReceipt: (body) => request('receipts', { method: 'POST', body }),

  getPantry: () => request('pantry'),
  savePantry: (items) => request('pantry', { method: 'PUT', body: { items } }),
  addPantry: (items) => request('pantry', { method: 'POST', body: { items } }),
  lookupBarcode: (upc) => request('barcode-lookup', { params: { upc } }),
  identifyPantry: (body) => request('identify-pantry', { method: 'POST', body }),

  logs: (params) => request('logs', { params }),
}
