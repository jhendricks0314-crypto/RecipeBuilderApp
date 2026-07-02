// Structured logging into the Blobs `logs` store. Every caught error records
// what the user was doing (context), any code/description, and a stack, so the
// admin logs page can show a detailed picture.
import { stores, writeJSON, id } from './blobs.js'

export async function logError({ req, user, action, code, message, detail, error }) {
  try {
    const entry = {
      id: id('log_'),
      ts: new Date().toISOString(),
      level: 'error',
      action: action || 'unknown',        // what the user was doing
      code: code || (error && error.code) || null,
      message: message || (error && error.message) || 'Unhandled error',
      detail: detail || null,
      stack: error && error.stack ? String(error.stack).split('\n').slice(0, 8).join('\n') : null,
      user: user ? { email: user.email, profileId: user.profileId } : null,
      path: req ? new URL(req.url).pathname : null,
      method: req ? req.method : null,
      userAgent: req ? req.headers.get('user-agent') : null,
    }
    await writeJSON(stores.logs(), entry.id, entry)
  } catch {
    // Logging must never throw into the caller.
  }
}

export async function logEvent({ req, user, action, message, detail, level = 'info' }) {
  try {
    const entry = {
      id: id('log_'),
      ts: new Date().toISOString(),
      level,
      action,
      message: message || action,
      detail: detail || null,
      user: user ? { email: user.email, profileId: user.profileId } : null,
      path: req ? new URL(req.url).pathname : null,
    }
    await writeJSON(stores.logs(), entry.id, entry)
  } catch {}
}
