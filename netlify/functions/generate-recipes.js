// POST /api/generate-recipes — synchronous generation.
//
// Kept for speed: when the work fits inside Netlify's function limit this
// returns in one round trip, with no polling. The client falls back to the
// background function (/api/generate-background + /api/job) when this times out,
// which is what makes long generations reliable on any plan.
//
// The actual logic lives in _shared/generate-core.js so both paths run the same
// code and can't drift apart.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { runGeneration } from './_shared/generate-core.js'
import { logError } from './_shared/log.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()
  if (!user.profileId) return bad('Create a profile first.')

  try {
    const body = await req.json()
    const result = await runGeneration(body, user)
    return ok(result)
  } catch (error) {
    if (error.code === 'BAD_REQUEST') return bad(error.message)
    await logError({ req, user, action: 'generate-recipes', error, detail: error.detail || error.partial || null })
    return bad(error.code ? error.message : `Recipe generation failed: ${error.message}`, 500)
  }
}
