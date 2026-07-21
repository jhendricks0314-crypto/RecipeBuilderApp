// Run async work with a cap on how much is in flight at once.
//
// Worth being precise about what this can and can't do here. These calls are
// I/O-bound — the browser is idle, waiting on the network — so threads or
// workers would buy nothing. What DOES help is overlapping several independent
// requests, which is all this is.
//
// It cannot speed up a single AI response: a model writes tokens one after
// another, so one generation takes as long as it takes no matter how many
// workers are watching it. Concurrency only pays off when there are genuinely
// separate requests to overlap — a batch of receipts, or frames from a scan.
export async function mapPool(items, worker, { concurrency = 3, onProgress, signal } = {}) {
  const results = new Array(items.length)
  let next = 0
  let done = 0

  const run = async () => {
    while (next < items.length) {
      if (signal?.aborted) return
      const i = next++
      try {
        results[i] = { ok: true, value: await worker(items[i], i) }
      } catch (error) {
        results[i] = { ok: false, error }
      }
      done++
      onProgress?.(done, items.length)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run)
  )
  return results
}
