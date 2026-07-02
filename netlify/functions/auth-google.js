// Google OAuth SSO — authorization-code flow.
//   GET /api/auth-google            -> redirect to Google consent
//   GET /api/auth-google/callback   -> exchange code, set session cookie
import { signSession, sessionCookie, siteURL, json } from './_shared/auth.js'
import { logError } from './_shared/log.js'

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo'

function redirectURI(req) {
  return `${siteURL(req)}/api/auth-google/callback`
}

export default async (req) => {
  const url = new URL(req.url)
  const isCallback = url.pathname.endsWith('/callback')

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return json(
      { error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' },
      { status: 500 }
    )
  }

  // --- Step 1: start ---
  if (!isCallback) {
    const returnTo = url.searchParams.get('returnTo') || '/'
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectURI(req),
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state: encodeURIComponent(returnTo),
    })
    return new Response(null, { status: 302, headers: { location: `${AUTH}?${params}` } })
  }

  // --- Step 2: callback ---
  try {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') || '/'
    if (!code) return new Response('Missing code', { status: 400 })

    const tokenRes = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectURI(req),
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`)
    const tokens = await tokenRes.json()

    const infoRes = await fetch(USERINFO, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })
    if (!infoRes.ok) throw new Error(`Userinfo failed: ${await infoRes.text()}`)
    const info = await infoRes.json()

    if (!info.email || !info.email_verified) {
      return new Response('Google account email not verified', { status: 403 })
    }

    const token = signSession({
      sub: info.email.toLowerCase(),
      name: info.name || '',
      picture: info.picture || '',
    })

    const returnTo = decodeURIComponent(state)
    return new Response(null, {
      status: 302,
      headers: { location: returnTo, 'set-cookie': sessionCookie(token) },
    })
  } catch (error) {
    await logError({ req, action: 'google-oauth-callback', error })
    return new Response('Sign-in failed. Please try again.', { status: 500 })
  }
}
