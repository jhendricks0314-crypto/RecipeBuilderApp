import { useState, useEffect, useRef } from 'react'
import { useAuth } from './auth.jsx'

// Draft caching: keeps in-progress form input and unsaved work in localStorage
// so nothing is lost if the app is closed, reloaded, or crashes. Keys are
// namespaced per signed-in account so linked users on one device don't collide.
//
// (This is a normal installed web app, so localStorage is the right tool here.)
const PREFIX = 'forkcast:draft:'

const hasLS = () => {
  try { return typeof localStorage !== 'undefined' } catch { return false }
}
function read(key) {
  if (!hasLS()) return undefined
  try { const v = localStorage.getItem(key); return v == null ? undefined : JSON.parse(v) } catch { return undefined }
}
function write(key, value) {
  if (!hasLS()) return
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota / private mode — ignore */ }
}

// Remove every draft for a given account scope (used after onboarding, etc.).
export function clearDraftsFor(scope) {
  if (!hasLS()) return
  try {
    const pre = `${PREFIX}${scope || 'anon'}:`
    Object.keys(localStorage).filter((k) => k.startsWith(pre)).forEach((k) => localStorage.removeItem(k))
  } catch {}
}

// Like useState, but persisted (debounced) under a per-user key. Drop-in:
//   const [store, setStore] = usePersistentState('receipt.store', '')
export function usePersistentState(name, initial) {
  const auth = useAuth()
  const scope = auth?.user?.email || 'anon'
  const key = `${PREFIX}${scope}:${name}`

  const [state, setState] = useState(() => {
    const stored = read(key)
    return stored === undefined ? (typeof initial === 'function' ? initial() : initial) : stored
  })

  const timer = useRef()
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => write(key, state), 250)
    return () => clearTimeout(timer.current)
  }, [key, state])

  return [state, setState]
}
