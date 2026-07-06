import { useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { usePersistentState, clearDraftsFor } from '../lib/persist.jsx'
import { Banner, Spinner } from '../components/ui.jsx'
import { IconFork } from '../components/icons.jsx'

export default function Onboarding() {
  const { user, refresh, logout } = useAuth()
  const [displayName, setDisplayName] = usePersistentState('onboarding.displayName', user?.name || '')
  const [phone, setPhone] = usePersistentState('onboarding.phone', '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      await api.createProfile({ displayName, phone })
      clearDraftsFor(user?.email) // onboarding done — drop its cached fields
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--saffron)', marginBottom: 8 }}>
          <IconFork />
        </div>
        <h1 style={{ fontSize: 32 }}>Set up your kitchen</h1>
        <p style={{ margin: '8px 0 22px' }}>
          You're signed in as {user?.email}. Create your profile — you'll be the
          owner and can invite others later.
        </p>

        <div className="card" style={{ textAlign: 'left', color: 'var(--ink)' }}>
          {error && <Banner kind="error">{error}</Banner>}
          <div className="field">
            <label className="label">Profile name</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="The Hendricks Kitchen" />
          </div>
          <div className="field">
            <label className="label">Cell number</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" inputMode="tel" />
            <div className="hint">Used so friends can share recipes with you by number.</div>
          </div>
          <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : 'Create profile'}
          </button>
        </div>

        <button className="linklike" style={{ color: '#8ea091', marginTop: 18 }} onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  )
}
