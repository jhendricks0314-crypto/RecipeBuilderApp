// GET /api/health
// Checks the things that actually break in production — is the API key present,
// is the configured model valid, is storage reachable — and says plainly which
// one is wrong. Signed-in users get the summary; the admin gets details.
import { getUser, ok, unauth } from './_shared/auth.js'
import { stores as S } from './_shared/blobs.js'

const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'

export default async (req) => {
  const user = await getUser(req)
  if (!user) return unauth()

  const checks = []
  const add = (name, ok_, detail, fix) => checks.push({ name, ok: ok_, detail, fix: ok_ ? null : fix })

  // --- API key present? ---
  const key = process.env.ANTHROPIC_API_KEY
  add('Claude API key', !!key,
    key ? `set (…${key.slice(-4)})` : 'missing',
    'Add ANTHROPIC_API_KEY under Site settings → Environment variables, then redeploy.')

  // --- Does the configured model actually answer? ---
  if (key) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL(),
          max_tokens: 4,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      })
      if (res.ok) {
        add('Claude model', true, `${MODEL()} responding`)
      } else {
        const text = await res.text()
        let msg = text.slice(0, 200)
        try { msg = JSON.parse(text)?.error?.message || msg } catch {}
        add('Claude model', false, `${MODEL()} → ${res.status}: ${msg}`,
          res.status === 404 || /model/i.test(msg)
            ? 'That model string is retired or misspelled. Set CLAUDE_MODEL=claude-sonnet-4-6.'
            : res.status === 401 || res.status === 403
              ? 'The API key was rejected — check it in the Anthropic console.'
              : 'Try again shortly.')
      }
    } catch (e) {
      add('Claude model', false, e.message, 'The function could not reach api.anthropic.com.')
    }
  }

  // --- Storage reachable? ---
  try {
    await S.profiles().list({ limit: 1 })
    add('Storage (Netlify Blobs)', true, 'reachable')
  } catch (e) {
    add('Storage (Netlify Blobs)', false, e.message,
      'Blobs is enabled automatically on Netlify; locally you need `netlify dev`.')
  }

  // --- Optional integrations ---
  add('Email sending', !!process.env.RESEND_API_KEY,
    process.env.RESEND_API_KEY ? 'configured' : 'not configured (optional)',
    'Set RESEND_API_KEY to email shopping lists. Sharing links still work without it.')
  add('Nearby store search', !!process.env.GOOGLE_PLACES_API_KEY,
    process.env.GOOGLE_PLACES_API_KEY ? 'configured' : 'not configured (optional)',
    'Set GOOGLE_PLACES_API_KEY for real store lookup. A built-in chain list is used otherwise.')

  const required = checks.filter((c) => !/optional/.test(c.detail || ''))
  return ok({
    healthy: required.every((c) => c.ok),
    model: MODEL(),
    checks: user.isAdmin ? checks : checks.map(({ name, ok: o, fix }) => ({ name, ok: o, fix })),
  })
}
