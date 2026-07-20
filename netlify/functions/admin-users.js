// GET /api/admin-users
// Every kitchen on the app, with its owner, collaborator, and activity counts.
// Admin only (ADMIN_EMAIL) — same gate as /logs, and not linked in the UI.
import { getUser, ok, unauth, forbidden } from './_shared/auth.js'
import { stores as S, listAll } from './_shared/blobs.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.isAdmin) return forbidden()

  const [profiles, recipes, lists, pantries, prices] = await Promise.all([
    listAll(S.profiles()),
    listAll(S.recipes()),
    listAll(S.shoppingLists()),
    listAll(S.pantry()),
    listAll(S.receiptItems()),
  ])

  const countBy = (rows, key = 'profileId') =>
    rows.reduce((m, r) => { const k = r[key]; if (k) m[k] = (m[k] || 0) + 1; return m }, {})

  const recipeCounts = countBy(recipes)
  const listCounts = countBy(lists)
  const pantryCounts = pantries.reduce((m, p) => {
    if (p.profileId) m[p.profileId] = (p.items || []).length
    return m
  }, {})
  // Price records are contributed by a person, not a kitchen.
  const priceByEmail = countBy(prices, 'contributedBy')

  const rows = profiles.map((p) => {
    const emails = [p.ownerEmail, p.collaborator?.email].filter(Boolean)
    return {
      id: p.id,
      displayName: p.displayName || '(unnamed)',
      ownerEmail: p.ownerEmail,
      collaborator: p.collaborator?.email || null,
      zip: p.zip || '',
      createdAt: p.createdAt || null,
      recipes: recipeCounts[p.id] || 0,
      lists: listCounts[p.id] || 0,
      pantryItems: pantryCounts[p.id] || 0,
      pricesContributed: emails.reduce((n, e) => n + (priceByEmail[e] || 0), 0),
    }
  })
  rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  return ok({
    profiles: rows,
    totals: {
      kitchens: rows.length,
      people: rows.reduce((n, r) => n + 1 + (r.collaborator ? 1 : 0), 0),
      recipes: recipes.length,
      lists: lists.length,
      prices: prices.length,
    },
  })
}
