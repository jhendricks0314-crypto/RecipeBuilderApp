import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from './api.js'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setUser(me)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = () => {
    const returnTo = window.location.pathname + window.location.search
    window.location.href = `/api/auth-google?returnTo=${encodeURIComponent(returnTo)}`
  }
  const logout = async () => {
    await api.logout()
    setUser(null)
    window.location.href = '/'
  }

  return (
    <AuthCtx.Provider value={{ user, loading, refresh, login, logout, setUser }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
