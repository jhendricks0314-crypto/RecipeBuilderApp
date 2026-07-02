// Session + request helpers shared by every function.
// A session is a JWT (signed with SESSION_SECRET) stored in an httpOnly cookie.
import jwt from 'jsonwebtoken'
import { stores, readJSON } from './blobs.js'

const COOKIE = 'fc_session'
const SECRET = () => process.env.SESSION_SECRET || 'dev-insecure-secret'
const ADMIN = () => (process.env.ADMIN_EMAIL || 'jhendricks0314@gmail.com').toLowerCase()

export function signSession(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: '30d' })
}

export function sessionCookie(token, { clear = false } = {}) {
  const attrs = [
    `${COOKIE}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    clear ? 'Max-Age=0' : 'Max-Age=2592000',
  ]
  return attrs.join('; ')
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => {
      const i = c.indexOf('=')
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))]
    }).filter((p) => p[0])
  )
}

// Returns the decoded session { sub (email), name, picture } or null.
export function getSession(req) {
  try {
    const cookies = parseCookies(req.headers.get('cookie') || '')
    const token = cookies[COOKIE]
    if (!token) return null
    return jwt.verify(token, SECRET())
  } catch {
    return null
  }
}

// Resolve the full app user: session + the profile they belong to.
export async function getUser(req) {
  const session = getSession(req)
  if (!session) return null
  const email = session.sub.toLowerCase()
  const idx = await readJSON(stores.emailIndex(), email)
  let profile = null
  if (idx) profile = await readJSON(stores.profiles(), idx.profileId)
  return {
    email,
    name: session.name || '',
    picture: session.picture || '',
    isAdmin: email === ADMIN(),
    profileId: idx?.profileId || null,
    role: idx?.role || null, // 'owner' | 'member'
    profile,
  }
}

export function isAdminEmail(email) {
  return (email || '').toLowerCase() === ADMIN()
}

// --- Response helpers -------------------------------------------------------
export function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}
export const ok = (b) => json(b)
export const bad = (msg, status = 400) => json({ error: msg }, { status })
export const unauth = () => json({ error: 'Not signed in' }, { status: 401 })
export const forbidden = () => json({ error: 'Not allowed' }, { status: 403 })

export function siteURL(req) {
  const url = new URL(req.url)
  // Behind Netlify's edge, TLS is terminated upstream, so trust the forwarded
  // headers for the public origin (needed so the OAuth redirect_uri matches).
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  const host = req.headers.get('x-forwarded-host') || url.host
  return `${proto}://${host}`
}
