import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { logout } from '../mock/api'
import { resetDb } from '../mock/store'
import { useMockDb, useSession } from '../lib/hooks'
import { Button } from './Button'

function DemoBanner() {
  return (
    <div className="demo-banner" role="status">
      <div className="container demo-banner__inner">
        <strong>Demo mode</strong>
        <span>
          Sample data only. Nothing is saved and everything resets when you
          reload.
        </span>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          style={{ marginLeft: 'auto', color: 'inherit' }}
          onClick={() => {
            resetDb()
            window.location.assign('/')
          }}
        >
          Reset demo data
        </button>
      </div>
    </div>
  )
}

export function SiteHeader() {
  const db = useMockDb()
  const session = useSession()
  const navigate = useNavigate()

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand">
          {db.business.businessName}
          <span className="brand__meta">Appointments</span>
        </Link>

        <nav className="site-nav" aria-label="Main">
          <NavLink to="/book" end={false}>
            Book
          </NavLink>
          <NavLink to="/appointments">My appointments</NavLink>
          {session ? (
            <>
              <span className="meta" style={{ paddingInline: 'var(--space-2)' }}>
                {session.name}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void logout().then(() => navigate('/'))
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <NavLink to="/signin">Sign in</NavLink>
          )}
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  const db = useMockDb()
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span>
          {db.business.businessName} · {db.business.businessEmail}
        </span>
        <span className="mono">
          Times shown in {db.business.timezone.replace('_', ' ')} · Payment at
          the business location
        </span>
      </div>
    </footer>
  )
}

export function AppLayout() {
  return (
    <div className="page">
      <DemoBanner />
      <SiteHeader />
      <main className="main">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
