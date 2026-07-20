import { useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { usePersistentState, clearDraftsFor } from '../lib/persist.jsx'
import { Banner, Spinner } from '../components/ui.jsx'
import { IconRain } from '../components/icons.jsx'

export default function Onboarding() {
  const { user, refresh, logout } = useAuth()
  const [displayName, setDisplayName] = usePersistentState('onboarding.displayName', user?.name || '')
  const [zip, setZip] = usePersistentState('onboarding.zip', '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      await api.createProfile({ displayName, zip })
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
          <IconRain />
        </div>
        <h1 style={{ fontSize: 32 }}>Set up your kitchen</h1>
        <p style={{ margin: '8px 0 22px' }}>
          You're signed in as {user?.email}. Set up your kitchen — this account
          owns it, and everything you save lives here.
        </p>

        <div className="card" style={{ textAlign: 'left', color: 'var(--ink)' }}>
          {error && <Banner kind="error">{error}</Banner>}
          <div className="field">
            <label className="label">Kitchen name</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="The Hendricks Kitchen" />
          </div>
          <div className="field">
            <label className="label">ZIP code <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
            <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="72701" inputMode="numeric" />
            <div className="hint">Used to estimate grocery prices for your area. You can change it any time.</div>
          </div>
          <button className="btn btn-primary btn-block" onClick={submit} disabled={busy || !displayName.trim()}>
            {busy ? <Spinner /> : 'Create my kitchen'}
          </button>
        </div>

        <button className="linklike" style={{ color: '#8ea091', marginTop: 18 }} onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  )
}
