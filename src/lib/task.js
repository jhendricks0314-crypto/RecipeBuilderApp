import { api } from './api.js'

// Runs a request that might take longer than a serverless function is allowed
// to live.
//
// It tries the ordinary synchronous endpoint first, because when the work is
// quick that's one round trip and no polling. If that runs out of time — Netlify
// kills synchronous functions at 10s, or 26s on Pro — the identical request is
// handed to a background function (15 minutes) and polled until it finishes.
//
// So quick requests stay quick and slow ones simply take longer rather than
// failing. Nothing needs tuning per feature.
const POLL_MS = 1500
const POLL_TIMEOUT_MS = 5 * 60 * 1000

const newJobId = () =>
  `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

// Only genuine timeouts should be retried. Retrying a bad request or an auth
// failure just fails again, more slowly.
const looksLikeTimeout = (err) =>
  err?.status === 504 ||
  err?.status === 502 ||
  /timed out|took longer|timeout|gateway/i.test(err?.message || '')

export async function runTask(task, body, { sync, onSlow } = {}) {
  try {
    return await sync(body)
  } catch (err) {
    if (!looksLikeTimeout(err)) throw err
    onSlow?.()
    return background(task, body)
  }
}

async function background(task, body) {
  const jobId = newJobId()
  await api.startBackgroundTask({ ...body, task, jobId })   // 202, immediately

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
    if (status.status === 'error') throw new Error(status.message || 'That request failed.')
  }
  throw new Error("That's taken unusually long. Please try again.")
}

export const generate = (body, opts) =>
  runTask('generate', body, { sync: (b) => api.generateRecipes(b), ...opts })

export const parseReceipt = (body, opts) =>
  runTask('parse-receipt', body, { sync: (b) => api.parseReceipt(b), ...opts })
