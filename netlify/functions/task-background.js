// Runs any long task as a Netlify BACKGROUND function (15 minute limit) and
// writes the result into the `jobs` store for the client to poll via /api/job.
//
// Synchronous functions are killed at 10s (26s on Pro), which some AI work
// legitimately exceeds — a multi-page PDF receipt especially. Rather than adding
// a bespoke background endpoint per feature, tasks register here by name so the
// same queue, polling and error handling serve all of them.
import { getUser } from './_shared/auth.js'
import { stores as S, writeJSON } from './_shared/blobs.js'
import { runGeneration } from './_shared/generate-core.js'
import { parseReceipt } from './_shared/receipt-core.js'
import { logError } from './_shared/log.js'

export const config = { background: true }

// Plenty of headroom inside the 15 minute ceiling.
const LONG = 10 * 60 * 1000

const TASKS = {
  generate: (body, user) => runGeneration(body, user, { timeoutMs: LONG }),
  'parse-receipt': (body) => parseReceipt(body, { timeoutMs: LONG }),
}

const put = (jobId, value) => writeJSON(S.jobs(), jobId, { ...value, at: new Date().toISOString() })

export default async (req) => {
  let jobId = null
  try {
    const body = await req.json()
    jobId = body.jobId
    if (!jobId) return new Response('missing jobId', { status: 400 })

    const run = TASKS[body.task || 'generate']
    if (!run) {
      await put(jobId, { status: 'error', message: `Unknown task "${body.task}".` })
      return new Response('', { status: 202 })
    }

    const user = await getUser(req)
    if (!user?.profileId) {
      await put(jobId, { status: 'error', message: 'Not signed in.' })
      return new Response('', { status: 202 })
    }

    await put(jobId, { status: 'running' })
    await put(jobId, { status: 'done', result: await run(body, user) })
  } catch (error) {
    // The client is polling, so failures have to land in the job record —
    // there's no open request left to return them on.
    if (jobId) {
      await put(jobId, {
        status: 'error',
        message: error.code ? error.message : `Task failed: ${error.message}`,
      })
    }
    await logError({ req, action: 'task-background', error, detail: error.detail || error.partial || null })
  }
  return new Response('', { status: 202 })
}
