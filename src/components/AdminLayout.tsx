import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/session'
import { useSession } from '../lib/hooks'
import { Button } from './Button'

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/appointments', label: 'Appointments', end: false },
  { to: '/admin/services', label: 'Services', end: false },
] as const

export function AdminLayout() {
  const session = useSession()
  const navigate = useNavigate()

  return (
    <div className="workspace">
      <aside className="workspace__sidebar">
        <div className="workspace__brand">
          <span className="workspace__brand-name">Slotly</span>
          <span className="workspace__brand-meta">Admin workspace</span>
        </div>

        <nav className="workspace__nav" aria-label="Admin workspace">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="workspace__sidebar-footer">
          {session ? (
            <div className="workspace__identity">
              <span className="workspace__identity-name">{session.name}</span>
              <span className="workspace__identity-email">{session.email}</span>
            </div>
          ) : null}
          <Link className="text-sm" to="/change-password">
            Change password
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="workspace__signout"
            onClick={() => {
              void signOut().then(() => navigate('/'))
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <div className="workspace__main">
        <header className="workspace__topbar">
          <div className="workspace__topbar-inner">
            <span className="eyebrow">Admin workspace</span>
            <Link className="text-sm" to="/">
              View public site
            </Link>
          </div>
        </header>
        <main className="workspace__content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
