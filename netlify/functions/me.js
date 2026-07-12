// GET  /api/me      -> current user + profile summary
// POST /api/me/logout (action=logout) -> clear session cookie
import { getUser, getSession, sessionCookie, ok, unauth } from './_shared/auth.js'

export default async (req) => {
  const url = new URL(req.url)
  if (url.pathname.endsWith('/logout') || url.searchParams.get('action') === 'logout') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie('', { clear: true }) },
    })
  }

  const session = getSession(req)
  if (!session) return unauth()
  const user = await getUser(req)
  return ok({
    email: user.email,
    name: user.name,
    picture: user.picture,
    isAdmin: user.isAdmin,
    hasProfile: !!user.profileId,
    role: user.role,
    profile: user.profile
      ? {
          id: user.profile.id,
          ownerEmail: user.profile.ownerEmail,
          displayName: user.profile.displayName,
          zip: user.profile.zip || '',
          prefs: user.profile.prefs || {},
          members: user.profile.members || [],
        }
      : null,
  })
}
