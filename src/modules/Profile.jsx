import { useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Banner, Spinner, Toast } from '../components/ui.jsx'
import { fromNow } from '../lib/util.js'

export default function Profile() {
  const { user, refresh, logout } = useAuth()
  const p = user?.profile

  const isOwner = user?.role === 'owner'
  const collab = p?.collaborator || null
  const [inviteEmail, setInviteEmail] = useState('')
  const [displayName, setDisplayName] = useState(p?.displayName || '')
  const [zip, setZip] = useState(p?.zip || '')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800) }
  const run = async (key, fn, ok) => {
    setBusy(key); setError('')
    try { await fn(); await refresh(); if (ok) flash(ok) } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  return (
    <div>
      <div className="section-title">Profile</div>
      <h1 className="page-h">{p?.displayName}</h1>
      <p className="page-sub">Signed in as {user.email}{isOwner ? ' — you own this kitchen.' : ' — you collaborate on this kitchen.'}</p>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card">
        <strong>Details</strong>
        <hr className="perf" />
        <div className="field">
          <label className="label">Kitchen name</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">ZIP code</label>
          <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" placeholder="72701" />
          <div className="hint">Used to estimate grocery prices. Saved until you change it.</div>
        </div>
        {isOwner && <button className="btn btn-dark btn-sm" style={{ marginTop: 14 }}
          onClick={() => run('save', () => api.updateProfile({ displayName, zip }), 'Saved')} disabled={busy === 'save'}>
          {busy === 'save' ? <Spinner light /> : 'Save changes'}
        </button>}
      </div>

      <div className="card">
        <strong>Kitchen access</strong>
        <hr className="perf" />
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
          You can add one other person to this kitchen. You'll both see the same recipes, pantry,
          shopping lists and prices — nothing needs sharing back and forth.
        </p>

        <div className="check-row" style={{ padding: '10px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{p?.ownerEmail}</div>
            <div className="muted" style={{ fontSize: 12 }}>Owner</div>
          </div>
        </div>

        {collab ? (
          <div className="check-row" style={{ padding: '10px 0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{collab.email}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Collaborator{collab.addedAt ? ` · joined ${fromNow(collab.addedAt)}` : ''}
              </div>
            </div>
            <button
              className="linklike tomato" style={{ fontSize: 12.5 }}
              disabled={busy === 'collab'}
              onClick={() => {
                const msg = isOwner
                  ? `Remove ${collab.email} from this kitchen? They'll lose access to everything in it.`
                  : 'Leave this kitchen? You will lose access to its recipes and lists.'
                if (!confirm(msg)) return
                run('collab', () => api.removeCollaborator(), isOwner ? 'Removed' : 'Left kitchen')
                  .then(() => { if (!isOwner) window.location.href = '/' })
              }}
            >
              {isOwner ? 'remove' : 'leave'}
            </button>
          </div>
        ) : isOwner ? (
          <>
            <label className="label" style={{ marginTop: 10 }}>Invite someone</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input" inputMode="email" placeholder="them@gmail.com"
                value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && inviteEmail.trim() &&
                  run('collab', () => api.addCollaborator(inviteEmail.trim()), 'Added').then(() => setInviteEmail(''))}
              />
              <button
                className="btn btn-primary"
                disabled={busy === 'collab' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail.trim())}
                onClick={() => run('collab', () => api.addCollaborator(inviteEmail.trim()), 'Added').then(() => setInviteEmail(''))}
              >
                {busy === 'collab' ? <Spinner /> : 'Add'}
              </button>
            </div>
            <div className="hint">
              They sign in with that Google account. It can't already own or collaborate on another kitchen.
            </div>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Only the owner can invite someone.</p>
        )}
      </div>

      <div className="card">
        <strong>Account</strong>
        <hr className="perf" />
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
          {isOwner && <button className="btn btn-danger"
            onClick={() => {
              if (!confirm('Delete this kitchen? This removes all of its recipes and shopping lists. This cannot be undone.')) return
              run('del', async () => { await api.deleteProfile() }, 'Deleted').then(() => { window.location.href = '/' })
            }}
            disabled={busy === 'del'}>
            {busy === 'del' ? <Spinner /> : 'Delete kitchen'}
          </button>}
        </div>
      </div>

      <Toast message={toast} />
    </div>
  )
}
