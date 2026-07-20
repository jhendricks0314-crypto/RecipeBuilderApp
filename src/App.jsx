import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { Loading } from './components/ui.jsx'
import Layout from './components/Layout.jsx'
import UpdatePrompt from './components/UpdatePrompt.jsx'
import InstallPrompt from './components/InstallPrompt.jsx'

import Login from './modules/Login.jsx'
import Onboarding from './modules/Onboarding.jsx'
import RecipeGenerator from './modules/RecipeGenerator.jsx'
import ShoppingList from './modules/ShoppingList.jsx'
import Recipes from './modules/Recipes.jsx'
import Prices from './modules/Prices.jsx'
import Pantry from './modules/Pantry.jsx'
import Profile from './modules/Profile.jsx'
import Logs from './modules/Logs.jsx'

export default function App() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Loading label="Warming up the kitchen…" />

  return (
    <>
      <Routes>
        {/* Hidden, admin-only. Not linked anywhere. */}
        <Route path="/logs" element={<Logs />} />

        {!user ? (
          <>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
          </>
        ) : !user.hasProfile ? (
          <>
            <Route path="/welcome" element={<Onboarding />} />
            <Route path="*" element={<Navigate to="/welcome" replace />} />
          </>
        ) : (
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/generate" replace />} />
            <Route path="/generate" element={<RecipeGenerator />} />
            <Route path="/shopping" element={<Navigate to="/list" replace />} />
            <Route path="/list" element={<ShoppingList />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/prices" element={<Prices />} />
            <Route path="/pantry" element={<Pantry />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/generate" replace />} />
          </Route>
        )}
      </Routes>
      {user && <UpdatePrompt />}
      {user && <InstallPrompt />}
    </>
  )
}
