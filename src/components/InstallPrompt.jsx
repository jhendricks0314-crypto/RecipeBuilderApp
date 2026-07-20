import { useEffect, useState } from 'react'

// Custom install prompt.
//
// Why this exists: the browser's own install banner is heuristic and stingy —
// it appears once, and after you dismiss it (or uninstall the app) Chrome
// suppresses it for months. Capturing `beforeinstallprompt` ourselves means we
// can offer installation whenever the person actually wants it, including right
// after they've uninstalled and changed their mind.
//
// iOS never fires this event at all, so Safari gets written instructions instead.
const DISMISS_KEY = 'rr:install-dismissed'

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream
}
function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [show, setShow] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)

  useEffect(() => {
    if (isStandalone()) return // already installed — nothing to offer

    const onPrompt = (e) => {
      e.preventDefault()          // stop Chrome's own banner
      setDeferred(e)              // keep the event so we can fire it on demand
      if (sessionStorage.getItem(DISMISS_KEY) !== '1') setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // Installed during this session — clear the prompt.
    const onInstalled = () => { setShow(false); setDeferred(null) }
    window.addEventListener('appinstalled', onInstalled)

    // iOS gives us no event, so offer instructions after a moment instead.
    let t
    if (isIOS() && sessionStorage.getItem(DISMISS_KEY) !== '1') {
      t = setTimeout(() => setShow(true), 3000)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      clearTimeout(t)
    }
  }, [])

  const install = async () => {
    if (!deferred) { setIosHelp(true); return }
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setShow(false)
    setDeferred(null)
  }

  const dismiss = () => {
    // Session-scoped only: reopening the app offers it again, unlike Chrome's
    // months-long cooldown.
    sessionStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
    setIosHelp(false)
  }

  if (!show) return null

  return (
    <div className="install-prompt" role="dialog" aria-label="Install RAIning Recipes">
      {iosHelp || (isIOS() && !deferred) ? (
        <div>
          <strong style={{ display: 'block', marginBottom: 4 }}>Add to your Home Screen</strong>
          <span style={{ fontSize: 13, lineHeight: 1.5 }}>
            Tap the Share button <span aria-hidden>􀈂</span> in Safari, then choose{' '}
            <strong>Add to Home Screen</strong>.
          </span>
        </div>
      ) : (
        <div>
          <strong style={{ display: 'block', marginBottom: 2 }}>Install RAIning Recipes</strong>
          <span style={{ fontSize: 13 }}>Full screen, offline-ready, and one tap from your home screen.</span>
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 10 }}>
        {!isIOS() && <button className="btn btn-primary btn-sm" onClick={install}>Install</button>}
        <button className="btn btn-ghost btn-sm" onClick={dismiss}>Not now</button>
      </div>
    </div>
  )
}

// Lets the Profile screen offer installation again at any time.
export function useCanInstall() {
  const [can, setCan] = useState(false)
  useEffect(() => {
    if (isStandalone()) return
    const on = () => setCan(true)
    window.addEventListener('beforeinstallprompt', on)
    if (isIOS()) setCan(true)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  return can
}
