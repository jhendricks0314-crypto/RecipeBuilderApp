// POST /api/share-recipe  { recipeIds: [], email }
// Shares recipes with another ForkCast household by their Google account email.
// No phone numbers, no SMS — the recipes are copied straight into their cookbook.
//
// (Everyone already on YOUR family profile sees all of its recipes automatically;
//  this is for sharing outside your household. To bring someone INTO your family,
//  use Profile -> add member.)
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores, readJSON, writeJSON, id } from './_shared/blobs.js'
import { logError, logEvent } from './_shared/log.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')

  try {
    const { recipeIds, email } = await req.json()
    const ids = Array.isArray(recipeIds) ? recipeIds : [recipeIds].filter(Boolean)
    const addr = (email || '').toLowerCase().trim()
    if (!ids.length) return bad('Pick at least one recipe to share.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return bad('Enter a valid email address.')

    // Who are we sharing with?
    const idx = await readJSON(stores.emailIndex(), addr)
    if (!idx) {
      return ok({
        shared: false,
        note: `${addr} isn't on ForkCast yet. Ask them to sign in once, then share again.`,
      })
    }
    if (idx.profileId === user.profileId) {
      return ok({
        shared: false,
        note: `${addr} is already on your family profile — they can see these recipes already.`,
      })
    }

    // Copy the recipes into their cookbook.
    let copied = 0
    for (const rid of ids) {
      const r = await readJSON(stores.recipes(), rid)
      if (!r || r.profileId !== user.profileId) continue
      const newId = id('rec_')
      await writeJSON(stores.recipes(), newId, {
        ...r,
        id: newId,
        profileId: idx.profileId,
        createdBy: user.email,
        sharedFrom: user.email,
        savedAt: new Date().toISOString(),
        comments: [],
        rating: 0,
      })
      copied++
    }
    if (!copied) return bad('No matching recipes found.')

    await logEvent({ req, user, action: 'recipe-share', message: `Shared ${copied} recipe(s) with ${addr}` })
    return ok({
      shared: true,
      copiedCount: copied,
      note: `Sent ${copied} recipe${copied !== 1 ? 's' : ''} to ${addr}. They'll find them in their cookbook.`,
    })
  } catch (error) {
    await logError({ req, user, action: 'share-recipe', error })
    return bad('Sharing failed. Please try again.', 500)
  }
}
