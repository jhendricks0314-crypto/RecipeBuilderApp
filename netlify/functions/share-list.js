// POST /api/share-list  { listId, email }
// Emails a shopping list to someone (no account needed) with checkboxes they can
// tap. Progress syncs back to the list in the app.
//
// HOW THE CHECKBOXES WORK — and the honest limit:
// Email clients strip JavaScript, so a checkbox that lives *entirely* inside the
// message can never report back to a server. What DOES work everywhere is a
// one-tap toggle link: each item's box is a link to /api/list-view?...&check=<id>,
// which flips that item server-side and re-renders the list. So tapping a box in
// the email opens the live list with that item ticked off — one tap, no login,
// and everyone (including the app) sees the same state.
//
// Sending needs RESEND_API_KEY. Without it, the function still creates the share
// and returns the link so the app can hand it to the user's own mail client.
import { getUser, ok, bad, unauth, forbidden, siteURL } from './_shared/auth.js'
import { stores as S, readJSON, writeJSON, id } from './_shared/blobs.js'
import { logError, logEvent } from './_shared/log.js'

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

export function renderListHTML(list, token, base, { forEmail = false } = {}) {
  const items = list.items.filter((i) => !i.removed)
  const done = items.filter((i) => i.checked).length
  const link = (item) => `${base}/api/list-view?token=${token}&check=${item.id}`

  const row = (i) => `
    <tr>
      <td style="padding:10px 6px 10px 0;vertical-align:top;width:30px">
        <a href="${link(i)}" style="text-decoration:none;font-size:20px;line-height:1;color:${i.checked ? '#3b7a57' : '#c9c3b4'}">
          ${i.checked ? '&#9745;' : '&#9744;'}
        </a>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e3ddcf">
        <a href="${link(i)}" style="text-decoration:none;color:inherit">
          <span style="font-weight:600;font-size:15px;color:${i.checked ? '#6f7a6f' : '#16231c'};${i.checked ? 'text-decoration:line-through' : ''}">
            ${esc(i.name)}
          </span>
          ${i.quantity ? `<div style="font-size:12.5px;color:#6f7a6f">${esc(i.quantity)}</div>` : ''}
        </a>
      </td>
      <td style="padding:10px 0;text-align:right;vertical-align:top;white-space:nowrap">
        ${i.bestPrice != null
          ? `<span style="font-family:monospace;font-size:13px;color:#6f7a6f">${i.priceSource === 'estimated' ? '~' : ''}$${Number(i.bestPrice).toFixed(2)}</span>`
          : ''}
        ${i.chosenStore ? `<div style="font-size:11px;color:#9aa39a">${esc(i.chosenStore)}</div>` : ''}
      </td>
    </tr>`

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(list.title)} — RAIning Recipes</title></head>
<body style="margin:0;padding:0;background:#f5f2ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:#16231c;color:#f5f2ea;border-radius:16px 16px 0 0;padding:20px 22px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#e0a82e;font-weight:700">RAIning Recipes</div>
      <div style="font-size:24px;font-weight:700;margin-top:4px">${esc(list.title)}</div>
      <div style="font-size:13px;color:#9fb0a2;margin-top:6px">
        ${done} of ${items.length} done${list.recipeNames?.length ? ` &middot; ${esc(list.recipeNames.join(', '))}` : ''}
      </div>
    </div>

    <div style="background:#fffdf8;border:1px solid #e3ddcf;border-top:none;border-radius:0 0 16px 16px;padding:8px 22px 22px">
      <table style="width:100%;border-collapse:collapse">${items.map(row).join('')}</table>

      ${forEmail ? `
      <p style="font-size:12.5px;color:#6f7a6f;margin:18px 0 0;line-height:1.5">
        Tap any box to check it off &mdash; it updates the live list for everyone.
      </p>
      <a href="${base}/api/list-view?token=${token}"
         style="display:inline-block;margin-top:12px;background:#e0a82e;color:#16231c;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:999px">
        Open the live list
      </a>` : `
      <p style="font-size:12.5px;color:#6f7a6f;margin:18px 0 0">
        Tap a box to check it off. Everyone with this link sees the same list.
      </p>`}
    </div>

    <p style="text-align:center;font-size:11.5px;color:#9aa39a;margin-top:16px">
      Shared from RAIning Recipes${list.sharedByName ? ` by ${esc(list.sharedByName)}` : ''}
    </p>
  </div>
</body></html>`
}

async function sendEmail({ to, subject, html, fromName }) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, reason: 'no-provider' }
  const from = process.env.MAIL_FROM || 'RAIning Recipes <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, reply_to: undefined }),
  })
  if (!res.ok) {
    const detail = await res.text()
    return { sent: false, reason: detail.slice(0, 200) }
  }
  return { sent: true }
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')
  if (req.method !== 'POST') return bad('Unsupported method.', 405)

  try {
    const { listId, email } = await req.json()
    const addr = (email || '').toLowerCase().trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return bad('Enter a valid email address.')

    const list = await readJSON(S.shoppingLists(), listId)
    if (!list || list.profileId !== user.profileId) return forbidden()

    // Reuse an existing share token for this list so the link stays stable.
    let token = list.shareToken
    if (!token) {
      token = id('shr_')
      list.shareToken = token
      await writeJSON(S.shoppingLists(), list.id, list)
    }
    await writeJSON(S.listShares(), token, {
      token, listId: list.id, profileId: user.profileId,
      createdAt: new Date().toISOString(),
    })

    // Remember the recipient for next time.
    const profile = await readJSON(S.profiles(), user.profileId)
    const known = new Set(profile.sharedEmails || [])
    if (!known.has(addr)) {
      profile.sharedEmails = [addr, ...(profile.sharedEmails || [])].slice(0, 20)
      await writeJSON(S.profiles(), profile.id, profile)
    }

    const base = siteURL(req)
    const who = user.name || profile.displayName || 'Someone'
    const html = renderListHTML({ ...list, sharedByName: who }, token, base, { forEmail: true })
    const result = await sendEmail({
      to: addr,
      subject: `${who} shared a shopping list: ${list.title}`,
      html,
    })

    const shareUrl = `${base}/api/list-view?token=${token}`
    await logEvent({ req, user, action: 'share-list', message: `Shared ${list.id} with ${addr} (sent=${result.sent})` })

    return ok({
      sent: result.sent,
      shareUrl,
      recipients: profile.sharedEmails,
      note: result.sent
        ? `Sent to ${addr}. They can tick items off straight from the email.`
        : result.reason === 'no-provider'
          ? 'Email sending isn\'t configured (set RESEND_API_KEY). Copy the link below and send it yourself — the checkboxes work the same.'
          : `Couldn't send the email: ${result.reason}. The link below still works.`,
    })
  } catch (error) {
    await logError({ req, user, action: 'share-list', error })
    return bad('Could not share the list.', 500)
  }
}
