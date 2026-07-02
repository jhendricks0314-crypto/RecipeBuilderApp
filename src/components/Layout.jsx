import { NavLink, Outlet, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { IconGenerate, IconCart, IconList, IconBook, IconScan, IconFork } from './icons.jsx'

const NAV = [
  { to: '/generate', label: 'Generate', Icon: IconGenerate },
  { to: '/shopping', label: 'Build List', Icon: IconCart },
  { to: '/list', label: 'Shopping', Icon: IconList },
  { to: '/recipes', label: 'Recipes', Icon: IconBook },
  { to: '/scan', label: 'Scan', Icon: IconScan },
]

export default function Layout() {
  const { user } = useAuth()
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/generate" className="brand" style={{ textDecoration: 'none' }}>
          <IconFork />
          <span>Fork<span className="dot">Cast</span></span>
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
