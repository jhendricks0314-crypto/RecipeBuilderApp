import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Loading, Banner, Spinner } from '../components/ui.jsx'
import { stamp } from '../lib/util.js'

// Hidden admin log viewer. Reachable only by typing /logs and signing in as the
// admin Gmail account. Shows detailed error context, codes, and stacks.
export default function Logs() {
  const { user, loading, login } = useAuth()
  const [logs, setLogs] = useState(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState({})
  const [tab, setTab] = useState('users')      // who's using it matters more than logs
  const [users, setUsers] = useState(null)
  const [totals, setTotals] = useState(null)

  useEffect(() => {
    if (!user?.isAdmin || tab !== 'users' || users) return
    api.adminUsers()
      .then((d) => { setUsers(d.profiles); setTotals(d.totals) })
      .catch((e) => setError(e.message))
  }, [user, tab, users])

  useEffect(() => {
    if (!user?.isAdmin) return
    api
      .logs(filter ? { level: filter } : undefined)
      .then((d) => { setLogs(d.logs); setCount(d.count) })
      .catch((e) => setError(e.message))
  }, [user, filter])

  if (loading) return <Loading />

  // Unauthenticated: quiet sign-in, no app chrome.
  if (!user) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1 style={{ fontSize: 28 }}>Restricted</h1>
          <p>This page requires administrator sign-in.</p>
          <button className="google-btn" onClick={login}>Sign in with Google</button>
        </div>
      </div>
    )
  }
  if (!user.isAdmin) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1 style={{ fontSize: 28 }}>Not authorized</h1>
          <p>This account doesn't have access to logs.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--ink)', minHeight: '100vh', color: 'var(--paper)' }}>
      <div className="container" style={{ maxWidth: 1000 }}>
        <h1 style={{ color: 'var(--paper)', fontSize: 30, paddingTop: 20 }}>System logs</h1>
        <p className="muted" style={{ color: '#9fb0a2' }}>{count} entries · signed in as {user.email}</p>

        <div className="chips" style={{ margin: '14px 0 4px' }}>
          <button className={`chip ${tab === 'users' ? 'on' : ''}`} onClick={() => setTab('users')}>Kitchens</button>
          <button className={`chip ${tab === 'logs' ? 'on' : ''}`} onClick={() => setTab('logs')}>Logs</button>
        </div>

        {tab === 'users' && (
          <>
            {totals && (
              <div className="chips" style={{ margin: '10px 0 16px' }}>
                {[
                  ['kitchens', totals.kitchens],
                  ['people', totals.people],
                  ['recipes', totals.recipes],
                  ['lists', totals.lists],
                  ['prices', totals.prices],
                ].map(([label, n]) => (
                  <span key={label} className="chip" style={{ cursor: 'default', background: 'var(--ink-2)', borderColor: 'var(--ink-3)', color: 'var(--paper)' }}>
                    <span className="mono" style={{ color: 'var(--saffron)', fontWeight: 700 }}>{n}</span> {label}
                  </span>
                ))}
              </div>
            )}
            {users === null ? (
              <div className="center-load" style={{ color: '#9fb0a2' }}><Spinner light /> Loading kitchens…</div>
            ) : users.length === 0 ? (
              <p style={{ color: '#9fb0a2' }}>Nobody has created a kitchen yet.</p>
            ) : (
              <div className="stack">
                {users.map((u) => (
                  <div key={u.id} style={{ background: 'var(--ink-2)', border: '1px solid var(--ink-3)', borderRadius: 12, padding: 14 }}>
                    <div className="row-between" style={{ gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--saffron)' }}>{u.displayName}</div>
                        <div className="mono" style={{ fontSize: 12, color: '#c3cdc4', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.ownerEmail}
                        </div>
                        {u.collaborator && (
                          <div className="mono" style={{ fontSize: 12, color: '#9fb0a2' }}>
                            + {u.collaborator}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="mono" style={{ fontSize: 11, color: '#9fb0a2' }}>
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                        </div>
                        {u.zip && <div className="mono" style={{ fontSize: 11, color: '#7f8f81' }}>{u.zip}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: '#9fb0a2' }}>
                      <span><span className="mono" style={{ color: 'var(--paper)' }}>{u.recipes}</span> recipes</span>
                      <span><span className="mono" style={{ color: 'var(--paper)' }}>{u.lists}</span> lists</span>
                      <span><span className="mono" style={{ color: 'var(--paper)' }}>{u.pantryItems}</span> pantry</span>
                      <span><span className="mono" style={{ color: 'var(--paper)' }}>{u.pricesContributed}</span> prices</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'logs' && (
        <>
        <div className="chips" style={{ margin: '14px 0' }}>
          {['', 'error', 'info'].map((f) => (
            <button key={f || 'all'} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f || 'All'}
            </button>
          ))}
        </div>

        {error && <Banner kind="error">{error}</Banner>}
        {!logs ? (
          <div className="center-load" style={{ color: '#9fb0a2' }}><Spinner light /> Loading logs…</div>
        ) : logs.length === 0 ? (
          <p style={{ color: '#9fb0a2' }}>No log entries yet.</p>
        ) : (
          <div className="stack">
            {logs.map((l) => (
              <div
                key={l.id}
                style={{
                  background: 'var(--ink-2)', border: '1px solid var(--ink-3)', borderRadius: 12, padding: 14,
                  borderLeft: `3px solid ${l.level === 'error' ? 'var(--tomato)' : 'var(--basil)'}`,
                }}
              >
                <div className="row-between" style={{ cursor: 'pointer' }} onClick={() => setExpanded((e) => ({ ...e, [l.id]: !e[l.id] }))}>
                  <div>
                    <span className="mono" style={{ fontSize: 11, color: '#9fb0a2' }}>{stamp(l.ts)}</span>
                    <span style={{ marginLeft: 10, fontWeight: 700, color: l.level === 'error' ? '#ff9a80' : '#9fe0b8' }}>
                      {l.level.toUpperCase()}
                    </span>
                    <span style={{ marginLeft: 10, color: 'var(--saffron)', fontWeight: 600 }}>{l.action}</span>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: '#9fb0a2' }}>{l.code || ''}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 14 }}>{l.message}</div>
                {expanded[l.id] && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: '#c3cdc4' }} className="stack">
                    {l.user && <div>User: <span className="mono">{l.user.email}</span> {l.user.profileId && `· ${l.user.profileId}`}</div>}
                    {l.path && <div>Path: <span className="mono">{l.method} {l.path}</span></div>}
                    {l.detail && <div>Detail: {typeof l.detail === 'string' ? l.detail : JSON.stringify(l.detail)}</div>}
                    {l.userAgent && <div style={{ color: '#7f8f81' }}>UA: {l.userAgent}</div>}
                    {l.stack && (
                      <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--ink)', padding: 10, borderRadius: 8, fontSize: 11, overflow: 'auto' }}>
                        {l.stack}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  )
}
