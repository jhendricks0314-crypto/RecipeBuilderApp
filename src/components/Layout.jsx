import { NavLink, Outlet, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { IconGenerate, IconCart, IconBook, IconScan, IconPantry } from './icons.jsx'
import BrandMark from './Brand.jsx'

const NAV = [
  { to: '/generate', label: 'Generate', Icon: IconGenerate },
  { to: '/pantry', label: 'Pantry', Icon: IconPantry },
  { to: '/list', label: 'Shopping', Icon: IconCart },
  { to: '/recipes', label: 'Recipes', Icon: IconBook },
  { to: '/prices', label: 'Prices', Icon: IconScan },
]

export default function Layout() {
  const { user } = useAuth()
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/generate" className="brand" style={{ textDecoration: 'none' }}>
          <BrandMark size={30} />
          <span>R<span className="dot">AI</span>ning Recipes</span>
        </Link>
        <div className="topbar-right">
          <Link to="/profile" aria-label="Profile">
            {user?.picture ? (
              <img className="avatar" src={user.picture} alt="Your profile" referrerPolicy="no-referrer" />
            ) : (
              <span className="avatar" style={{ display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                {(user?.name || user?.email || '?')[0]?.toUpperCase()}
              </span>
            )}
          </Link>
        </div>
      </header>

      <main className="container">
        <Outlet />
      </main>

      <nav className="bottomnav" aria-label="Primary">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
