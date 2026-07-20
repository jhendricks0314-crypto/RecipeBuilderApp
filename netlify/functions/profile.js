// Profile management.
//   POST /api/profile            { displayName, zip? }   -> create the family (caller = owner)
//   DELETE /api/profile                                  -> owner deletes the profile
//
// A profile is owned by the Google account that created it, and the owner may
// invite ONE collaborator so two people share the same kitchen — same recipes,
// pantry, lists and prices, no sharing back and forth.
//   POST   /api/profile/collaborator  { email }  -> owner invites (max 1)
//   DELETE /api/profile/collaborator             -> owner removes, or collaborator leaves
import { getSession, getUser, ok, bad, unauth, forbidden } from './_shared/auth.js'
import { stores, readJSON, writeJSON, listAll, id } from './_shared/blobs.js'
import { logError, logEvent } from './_shared/log.js'



export default async (req) => {
  const session = getSession(req)
  if (!session) return unauth()
  const user = await getUser(req)
  const url = new URL(req.url)
  const seg = url.pathname.split('/').filter(Boolean).pop()

  try {
    // ---- Create profile ----
    if (req.method === 'POST' && seg === 'profile') {
      if (user.profileId) return bad('You already belong to a profile.')
      const body = await req.json()
      if (!body.displayName?.trim()) return bad('A family name is required.')

      const profileId = id('prof_')
      const profile = {
        id: profileId,
        ownerEmail: user.email,
        displayName: body.displayName.trim(),
        zip: (body.zip || '').trim(), // used for price estimates; persists until changed
        prefs: {},                     // household cooking preferences
        collaborator: null,            // { email, addedAt } — at most one
        preferredStores: [],
        createdAt: new Date().toISOString(),
      }
      await writeJSON(stores.profiles(), profileId, profile)
      await writeJSON(stores.emailIndex(), user.email, { profileId, role: 'owner' })
      await logEvent({ req, user, action: 'profile-create', message: `Profile created for ${user.email}` })
      return ok({ profile })
    }

    // Everything below needs an existing profile.
    if (!user.profileId) return bad('Create a profile first.')
    const profile = await readJSON(stores.profiles(), user.profileId)
    if (!profile) return bad('Profile not found.')
    const isOwner = profile.ownerEmail === user.email

    // ---- Invite a collaborator (owner only, max one) ----
    if (req.method === 'POST' && seg === 'collaborator') {
      if (!isOwner) return forbidden()
      if (profile.collaborator) return bad('This kitchen already has a collaborator. Remove them first.')

      const { email } = await req.json()
      const addr = (email || '').toLowerCase().trim()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return bad('Enter a valid email address.')
      if (addr === profile.ownerEmail) return bad("That's your own account.")

      // They can't already be in another kitchen — a person belongs to one.
      const existing = await readJSON(stores.emailIndex(), addr)
      if (existing) {
        const other = await readJSON(stores.profiles(), existing.profileId)
        return bad(
          other && other.ownerEmail === addr
            ? `${addr} already has their own kitchen. They'd need to delete it first.`
            : `${addr} is already collaborating on another kitchen.`
        )
      }

      profile.collaborator = { email: addr, addedAt: new Date().toISOString() }
      await writeJSON(stores.profiles(), profile.id, profile)
      await writeJSON(stores.emailIndex(), addr, { profileId: profile.id, role: 'collaborator' })
      await logEvent({ req, user, action: 'collaborator-add', message: `${addr} joined ${profile.id}` })
      return ok({ profile })
    }

    // ---- Remove the collaborator (owner removes, or they leave) ----
    if (req.method === 'DELETE' && seg === 'collaborator') {
      if (!profile.collaborator) return bad('No collaborator to remove.')
      const leaving = profile.collaborator.email
      if (!isOwner && user.email !== leaving) return forbidden()

      profile.collaborator = null
      await writeJSON(stores.profiles(), profile.id, profile)
      await stores.emailIndex().delete(leaving)
      await logEvent({ req, user, action: 'collaborator-remove', message: `${leaving} left ${profile.id}` })
      return ok({ profile, left: !isOwner })
    }

    // ---- Update preferred stores / display fields ----
    if (req.method === 'PUT' && seg === 'profile') {
      const body = await req.json()
      if (!isOwner && (body.displayName !== undefined || body.zip !== undefined)) return forbidden()
      if (body.displayName) profile.displayName = body.displayName.trim()
      if (body.zip !== undefined) profile.zip = String(body.zip || '').trim()
      if (Array.isArray(body.preferredStores)) profile.preferredStores = body.preferredStores
      // Household cooking preferences (people, tools, exclusions, diets, toggles).
      // Stored on the profile, not the device, so allergy exclusions apply to
      // everyone in the family no matter who is generating the recipe.
      if (body.prefs && typeof body.prefs === 'object') {
        profile.prefs = { ...(profile.prefs || {}), ...body.prefs }
      }
      await writeJSON(stores.profiles(), profile.id, profile)
      return ok({ profile })
    }

    // ---- Delete the whole profile (owner only) ----
    if (req.method === 'DELETE' && seg === 'profile') {
      if (!isOwner) return forbidden()
      // Unlink the account, remove its recipes + shopping lists, then the profile.
      await stores.emailIndex().delete(profile.ownerEmail)
      if (profile.collaborator) await stores.emailIndex().delete(profile.collaborator.email)
      const recipes = await listAll(stores.recipes())
      for (const r of recipes.filter((r) => r.profileId === profile.id)) {
        await stores.recipes().delete(r.id)
      }
      const lists = await listAll(stores.shoppingLists())
      for (const l of lists.filter((l) => l.profileId === profile.id)) {
        await stores.shoppingLists().delete(l.id)
      }
      await stores.profiles().delete(profile.id)
      await logEvent({ req, user, action: 'profile-delete', message: `Deleted profile ${profile.id}` })
      return ok({ deleted: true })
    }

    return bad('Unsupported request.', 405)
  } catch (error) {
    await logError({ req, user, action: `profile:${seg}`, error })
    return bad('Something went wrong updating your profile.', 500)
  }
}
