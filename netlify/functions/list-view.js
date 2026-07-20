// GET /api/list-view?token=shr_...            -> the shared shopping list (public)
// GET /api/list-view?token=shr_...&check=item -> toggle that item, then show the list
//
// No login: the token IS the credential (an unguessable per-list link). This is
// what the checkboxes in the emailed list point at, so a recipient can tick items
// off with one tap and the app sees the same state instantly.
import { stores as S, readJSON, writeJSON } from './_shared/blobs.js'
import { renderListHTML } from './share-list.js'
import { logError } from './_shared/log.js'

const page = (html, status = 200) =>
  new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Never let a proxy cache a checked/unchecked state.
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  })

const notFound = () => page(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
   <div style="font-family:system-ui;max-width:420px;margin:80px auto;text-align:center;color:#16231c">
     <h1 style="font-size:22px">This list isn't available</h1>
     <p style="color:#6f7a6f">The link may have expired, or the list was deleted.</p>
   </div>`, 404)

export default async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const check = url.searchParams.get('check')
  if (!token) return notFound()

  try {
    const share = await readJSON(S.listShares(), token)
    if (!share) return notFound()

    const list = await readJSON(S.shoppingLists(), share.listId)
    if (!list || list.shareToken !== token) return notFound()

    // Toggle an item, then redirect back to the clean URL so a refresh (or the
    // browser's back button) doesn't flip it a second time.
    if (check) {
      const idx = list.items.findIndex((i) => i.id === check)
      if (idx !== -1) {
        list.items[idx] = { ...list.items[idx], checked: !list.items[idx].checked }
        list.updatedAt = new Date().toISOString()
        await writeJSON(S.shoppingLists(), list.id, list)
      }
      return new Response(null, {
        status: 303,
        headers: { location: `/api/list-view?token=${token}`, 'cache-control': 'no-store' },
      })
    }

    const base = `${url.protocol}//${url.host}`
    return page(renderListHTML(list, token, base, { forEmail: false }))
  } catch (error) {
    await logError({ req, action: 'list-view', error })
    return notFound()
  }
}
