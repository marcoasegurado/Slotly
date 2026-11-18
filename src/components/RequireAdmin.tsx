import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useSession } from '../lib/hooks'
import { buttonClassName } from './Button'
import { Card } from './Card'
import { StateBlock } from './StateBlock'

/**
 * Client-side route guard for admin screens. Every admin endpoint enforces the
 * same role on the Worker, so this only decides what the browser shows.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const session = useSession()
  const location = useLocation()

  if (!session) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/signin?next=${next}`} replace />
  }

  if (session.mustChangePassword) {
    return <Navigate to="/change-password" replace />
  }

  if (session.role !== 'admin') {
    return (
      <div className="container main--narrow" style={{ paddingBlock: 'var(--space-12)' }}>
        <Card>
          <StateBlock
            icon="!"
            headingLevel={1}
            title="Admin access only"
            actions={
              <>
                <Link
                  className={buttonClassName('primary')}
                  to={session.role === 'staff' ? '/staff' : '/'}
                >
                  {session.role === 'staff'
                    ? 'Open the staff workspace'
                    : 'Back to the public site'}
                </Link>
              </>
            }
          >
            This area manages every appointment and service for the business. Sign
            in with an admin account to continue.
          </StateBlock>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
