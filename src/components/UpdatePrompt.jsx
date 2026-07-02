import { useRegisterSW } from 'virtual:pwa-register/react'
import { Spinner } from './ui.jsx'

// Detects when a new version has been deployed. With registerType:'autoUpdate'
// the new service worker installs in the background; this banner lets the user
// apply it immediately, and the app also refreshes on its own on next launch.
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Poll for a new deployment every 30 minutes while the app is open.
      if (reg) setInterval(() => reg.update(), 30 * 60 * 1000)
    },
  })

  if (!needRefresh) return null
  return (
    <div className="update-prompt" role="alert">
      <span>New version available</span>
      <button className="btn btn-dark btn-sm" onClick={() => updateServiceWorker(true)}>
        Refresh
      </button>
      <button
        className="btn btn-ghost btn-sm"
        style={{ borderColor: 'rgba(0,0,0,0.2)' }}
        onClick={() => setNeedRefresh(false)}
      >
        Later
      </button>
    </div>
  )
}
