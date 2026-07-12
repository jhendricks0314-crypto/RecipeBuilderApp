// Profile management.
//   POST /api/profile            { displayName, zip? }   -> create the family (caller = owner)
//   POST /api/profile/members    { email }               -> owner links a Gmail account
//   DELETE /api/profile/members  { email }               -> owner unlinks a member
//   DELETE /api/profile                                  -> owner deletes the profile
//
// Rules from the spec:
//   • The creator owns the profile.
//   • Only the owner can add other Gmail accounts.
//   • A Gmail being added must not already own its own profile.
//   • The owner may delete the profile.
import { getSession, getUser, ok, bad, unauth, forbidden } from './_shared/auth.js'
import { stores, readJSON, writeJSON, listAll, id } from './_shared/blobs.js'
import { logError, logEvent } from './_shared/log.js'

const isGmail = (e) => /^[^@\s]+@(gmail\.com|googlemail\.com)$/i.test(e || '')


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
        members: [{ email: user.email, role: 'owner', addedAt: new Date().toISOString() }],
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

    // ---- Add a member (owner only) ----
    if (req.method === 'POST' && seg === 'members') {
      if (!isOwner) return forbidden()
      const { email } = await req.json()
      const addr = (email || '').toLowerCase().trim()
      if (!isGmail(addr)) return bad('Only Gmail accounts can be linked.')
      if (addr === user.email) return bad('You already own this profile.')

      // The account must not already own a profile.
      const existing = await readJSON(stores.emailIndex(), addr)
      if (existing) {
        const other = await readJSON(stores.profiles(), existing.profileId)
        if (other && other.ownerEmail === addr) {
          return bad(`${addr} already owns their own profile and can't be linked.`)
        }
        if (existing.profileId === profile.id) return bad(`${addr} is already on this profile.`)
        return bad(`${addr} already belongs to another profile.`)
      }

      profile.members.push({ email: addr, role: 'member', addedAt: new Date().toISOString() })
      await writeJSON(stores.profiles(), profile.id, profile)
      await writeJSON(stores.emailIndex(), addr, { profileId: profile.id, role: 'member' })
      await logEvent({ req, user, action: 'profile-add-member', message: `Linked ${addr}` })
      return ok({ profile })
    }

    // ---- Remove a member (owner only) ----
    if (req.method === 'DELETE' && seg === 'members') {
      if (!isOwner) return forbidden()
      const { email } = await req.json()
      const addr = (email || '').toLowerCase().trim()
      if (addr === profile.ownerEmail) return bad("The owner can't be removed.")
      profile.members = profile.members.filter((m) => m.email !== addr)
      await writeJSON(stores.profiles(), profile.id, profile)
      await stores.emailIndex().delete(addr)
      return ok({ profile })
    }

    // ---- Update preferred stores / display fields ----
    if (req.method === 'PUT' && seg === 'profile') {
      const body = await req.json()
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
      // Unlink every member, remove owned recipes + shopping lists, then the profile.
      for (const m of profile.members) await stores.emailIndex().delete(m.email)
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
