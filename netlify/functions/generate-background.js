// Recipe generation, run as a BACKGROUND function.
//
// Why this exists: synchronous Netlify functions are killed at 10s (26s on Pro),
// and writing a recipe can legitimately take longer than that — especially with
// a higher-quality model. Rather than keep trimming the work to fit an arbitrary
// ceiling, this runs as a background function (15 minute limit), writes its
// result into the `jobs` store, and the client polls /api/job for it.
//
// Netlify replies 202 immediately, so nothing can time out. The trade is that
// the caller polls instead of waiting on one open request.
import { getUser } from './_shared/auth.js'
import { stores as S, writeJSON } from './_shared/blobs.js'
import { runGeneration } from './_shared/generate-core.js'
import { logError } from './_shared/log.js'

export const config = { background: true }

const put = (jobId, value) => writeJSON(S.jobs(), jobId, { ...value, at: new Date().toISOString() })

export default async (req) => {
  let jobId = null
  try {
    const body = await req.json()
    jobId = body.jobId
    if (!jobId) return new Response('missing jobId', { status: 400 })

    const user = await getUser(req)
    if (!user?.profileId) {
      await put(jobId, { status: 'error', message: 'Not signed in.' })
      return new Response('', { status: 202 })
    }

    await put(jobId, { status: 'running' })
    // 15 minutes available here — no fast-path budget.
    const result = await runGeneration(body, user, { timeoutMs: 10 * 60 * 1000 })
    await put(jobId, { status: 'done', result })
  } catch (error) {
    // The client is polling, so the failure has to land in the job record —
    // there is no open request left to return it on.
    if (jobId) {
      await put(jobId, {
        status: 'error',
        message: error.code ? error.message : `Generation failed: ${error.message}`,
      })
    }
    await logError({ req, action: 'generate-background', error, detail: error.detail || error.partial || null })
  }
  return new Response('', { status: 202 })
}
