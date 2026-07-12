import { useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Banner, Spinner, Toast } from '../components/ui.jsx'

export default function Profile() {
  const { user, refresh, logout } = useAuth()
  const p = user?.profile
  const isOwner = user?.role === 'owner'

  const [displayName, setDisplayName] = useState(p?.displayName || '')
  const [zip, setZip] = useState(p?.zip || '')
  const [newMember, setNewMember] = useState('')
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
      <p className="page-sub">You're signed in as {user.email}{isOwner ? ' — you own this profile.' : ' — you are a member of this profile.'}</p>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card">
        <strong>Details</strong>
        <hr className="perf" />
        <div className="field">
          <label className="label">Profile name</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!isOwner} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">ZIP code</label>
          <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} disabled={!isOwner} inputMode="numeric" placeholder="72701" />
          <div className="hint">Used to estimate grocery prices. Saved until you change it.</div>
        </div>
        {isOwner && (
          <button className="btn btn-dark btn-sm" style={{ marginTop: 14 }}
            onClick={() => run('save', () => api.updateProfile({ displayName, zip }), 'Saved')} disabled={busy === 'save'}>
            {busy === 'save' ? <Spinner light /> : 'Save changes'}
          </button>
        )}
      </div>

      <div className="card">
        <strong>Members</strong>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>People who can sign in to this profile. Only Gmail accounts that don't already own a profile can be added.</p>
        <hr className="perf" />
        <div className="stack">
          {(p?.members || []).map((m) => (
            <div key={m.email} className="row-between">
              <div>
                <div style={{ fontWeight: 600 }}>{m.email}</div>
                <div className="tag" style={{ marginTop: 2 }}>{m.role}</div>
              </div>
              {isOwner && m.role !== 'owner' && (
                <button className="linklike tomato" style={{ fontSize: 13 }}
                  onClick={() => run('rm' + m.email, () => api.removeMember(m.email), 'Member removed')}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        {isOwner && (
          <>
            <hr className="perf" />
            <label className="label">Add a Gmail account</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" placeholder="friend@gmail.com" value={newMember} onChange={(e) => setNewMember(e.target.value)} />
              <button className="btn btn-primary" disabled={busy === 'add' || !newMember}
                onClick={() => run('add', async () => { await api.addMember(newMember); setNewMember('') }, 'Member added')}>
                {busy === 'add' ? <Spinner /> : 'Add'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <strong>Account</strong>
        <hr className="perf" />
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
          {isOwner && (
            <button className="btn btn-danger"
              onClick={() => {
                if (!confirm('Delete this profile? This removes all its recipes and shopping lists and unlinks every member. This cannot be undone.')) return
                run('del', async () => { await api.deleteProfile() }, 'Profile deleted').then(() => { window.location.href = '/' })
              }}
              disabled={busy === 'del'}>
              {busy === 'del' ? <Spinner /> : 'Delete profile'}
            </button>
          )}
        </div>
      </div>

      <Toast message={toast} />
    </div>
  )
}
