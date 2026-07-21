// GET /api/job?id=...  -> status of an async generation job.
// Polled by the client while a background function does the work.
import { getUser, ok, bad, unauth } from './_shared/auth.js'
import { stores as S, readJSON } from './_shared/blobs.js'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return bad('Missing job id.')

  const job = await readJSON(S.jobs(), id)
  // A freshly-queued job may not have written its first record yet.
  if (!job) return ok({ status: 'pending' })

  if (job.status === 'done') {
    await S.jobs().delete(id).catch(() => {})   // one-shot; don't accumulate
    return ok({ status: 'done', result: job.result })
  }
  if (job.status === 'error') {
    await S.jobs().delete(id).catch(() => {})
    return ok({ status: 'error', message: job.message })
  }
  return ok({ status: job.status || 'running' })
}
