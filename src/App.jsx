import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { Loading } from './components/ui.jsx'
import Layout from './components/Layout.jsx'
import UpdatePrompt from './components/UpdatePrompt.jsx'

import Login from './modules/Login.jsx'
import Onboarding from './modules/Onboarding.jsx'
import RecipeGenerator from './modules/RecipeGenerator.jsx'
import GenerateShoppingList from './modules/GenerateShoppingList.jsx'
import ShoppingList from './modules/ShoppingList.jsx'
import Recipes from './modules/Recipes.jsx'
import ReceiptScanner from './modules/ReceiptScanner.jsx'
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
            <Route path="/shopping" element={<GenerateShoppingList />} />
            <Route path="/list" element={<ShoppingList />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/scan" element={<ReceiptScanner />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/generate" replace />} />
          </Route>
        )}
      </Routes>
      {user && <UpdatePrompt />}
    </>
  )
}
