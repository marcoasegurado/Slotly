import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/session'
import { useBusiness, useSession } from '../lib/hooks'
import { Button } from './Button'


export function SiteHeader() {
  const business = useBusiness()
  const session = useSession()
  const navigate = useNavigate()

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand">
          {business.businessName}
          <span className="brand__meta">Appointments</span>
        </Link>

        <nav className="site-nav" aria-label="Main">
          {session?.role === 'staff' ? (
            <NavLink to="/staff">Staff workspace</NavLink>
          ) : session?.role === 'admin' ? (
            <NavLink to="/admin">Admin workspace</NavLink>
          ) : (
            <>
              <NavLink to="/book" end={false}>
                Book
              </NavLink>
              <NavLink to="/appointments">My appointments</NavLink>
            </>
          )}
          {session ? (
            <>
              <span className="meta" style={{ paddingInline: 'var(--space-2)' }}>
                {session.name}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void signOut().then(() => navigate('/'))
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
  const business = useBusiness()
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <span>
          {business.businessName}
          {business.businessEmail ? ` · ${business.businessEmail}` : ''}
        </span>
        <span className="mono">
          Times shown in {business.timezone.replace('_', ' ')} · Payment at
          the business location
        </span>
      </div>
    </footer>
  )
}

export function AppLayout() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="main">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
