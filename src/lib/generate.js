import { api } from './api.js'

// Runs a generation request, surviving however long it takes.
//
// First it tries the plain synchronous endpoint, because when the work is quick
// that's one round trip and no polling. If that times out — Netlify kills
// synchronous functions at 10s, or 26s on Pro — it hands the same request to a
// background function (15 minute limit) and polls for the result.
//
// The effect: fast requests stay fast, slow ones simply take longer instead of
// failing. No tuning required.
const POLL_MS = 1500
const POLL_TIMEOUT_MS = 5 * 60 * 1000

const newJobId = () =>
  `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

const looksLikeTimeout = (err) =>
  err?.status === 504 ||
  err?.status === 502 ||
  /timed out|took longer|timeout|gateway/i.test(err?.message || '')

export async function generate(body, { onSlow } = {}) {
  try {
    return await api.generateRecipes(body)
  } catch (err) {
    if (!looksLikeTimeout(err)) throw err
    onSlow?.()   // let the UI say "this one's taking a while"
    return runInBackground(body)
  }
}

async function runInBackground(body) {
  const jobId = newJobId()
  await api.startBackgroundJob({ ...body, jobId })   // returns 202 straight away

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    let status
    try {
      status = await api.jobStatus(jobId)
    } catch {
      continue   // a dropped poll shouldn't abandon a job that's still running
    }
    if (status.status === 'done') return status.result
    if (status.status === 'error') throw new Error(status.message || 'Generation failed.')
  }
  throw new Error("That's taken unusually long. Please try again.")
}
