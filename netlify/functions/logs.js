// GET /api/logs  -> full error/event log. Restricted to ADMIN_EMAIL only.
// The page that reads this (/logs) is not linked anywhere in the UI.
import { getUser, ok, forbidden, unauth } from './_shared/auth.js'
import { stores, listAll } from './_shared/blobs.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.isAdmin) return forbidden()

  const url = new URL(req.url)
  const level = url.searchParams.get('level') // optional filter
  let logs = await listAll(stores.logs())
  if (level) logs = logs.filter((l) => l.level === level)
  logs.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
  return ok({ logs: logs.slice(0, 1000), count: logs.length })
}
