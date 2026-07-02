// POST /api/share-recipe  { recipeIds: [], phone }
// Shares one-to-many recipes with a contact by phone number.
//   • If a profile with that phone exists, the recipes are copied into it.
//   • If Twilio is configured, an SMS summary is sent to that number.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores, readJSON, writeJSON, listAll, id } from './_shared/blobs.js'
import { logError, logEvent } from './_shared/log.js'

const normPhone = (p) => (p || '').replace(/[^\d]/g, '')

async function sendSMS(to, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (!sid || !token || !from) return { sent: false, reason: 'Twilio not configured' }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: text }),
  })
  if (!res.ok) return { sent: false, reason: await res.text() }
  return { sent: true }
}

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')

  try {
    const { recipeIds, phone } = await req.json()
    const ids = Array.isArray(recipeIds) ? recipeIds : [recipeIds].filter(Boolean)
    const target = normPhone(phone)
    if (!ids.length) return bad('Pick at least one recipe to share.')
    if (target.length < 10) return bad('Enter a valid phone number.')

    // Gather the recipes (must belong to the sender).
    const recipes = []
    for (const rid of ids) {
      const r = await readJSON(stores.recipes(), rid)
      if (r && r.profileId === user.profileId) recipes.push(r)
    }
    if (!recipes.length) return bad('No matching recipes found.')

    // Find a profile whose phone matches (last 10 digits).
    const profiles = await listAll(stores.profiles())
    const match = profiles.find((p) => normPhone(p.phone).endsWith(target.slice(-10)))

    let copied = 0
    if (match && match.id !== user.profileId) {
      const now = new Date().toISOString()
      for (const r of recipes) {
        const rid = id('rec_')
        await writeJSON(stores.recipes(), rid, {
          ...r,
          id: rid,
          profileId: match.id,
          createdBy: user.email,
          sharedFrom: user.email,
          savedAt: now,
          comments: [],
          rating: 0,
        })
        copied++
      }
    }

    const names = recipes.map((r) => r.name).join(', ')
    const summary = `${user.name || 'A ForkCast friend'} shared ${recipes.length} recipe(s) with you: ${names}.` +
      (match ? ' They are now in your ForkCast recipes.' : ' Sign up for ForkCast to save them.')

    let sms = { sent: false, reason: 'no target profile' }
    if (match) sms = await sendSMS('+' + target, summary)

    await logEvent({ req, user, action: 'recipe-share', message: `Shared ${copied} to ${target.slice(-4)}`, detail: sms.reason })
    return ok({
      copiedToProfile: !!match,
      copiedCount: copied,
      smsSent: sms.sent,
      note: match
        ? sms.sent
          ? 'Recipes copied and a text was sent.'
          : 'Recipes copied to their profile. (SMS not sent — Twilio not configured.)'
        : 'No ForkCast profile uses that number yet, so nothing was copied.',
    })
  } catch (error) {
    await logError({ req, user, action: 'share-recipe', error })
    return bad('Sharing failed. Please try again.', 500)
  }
}
