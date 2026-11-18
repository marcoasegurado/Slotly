import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useSession } from '../lib/hooks'
import { buttonClassName } from './Button'
import { Card } from './Card'
import { StateBlock } from './StateBlock'

/**
 * Client-side route guard for the staff workspace. The real Worker must
 * enforce the same rule on every staff endpoint.
 */
export function RequireStaff({ children }: { children: ReactNode }) {
  const session = useSession()
  const location = useLocation()

  if (!session) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/signin?next=${next}`} replace />
  }

  if (session.mustChangePassword) {
    return <Navigate to="/change-password" replace />
  }

  if (session.role !== 'staff') {
    return (
      <div className="container main--narrow" style={{ paddingBlock: 'var(--space-12)' }}>
        <Card>
          <StateBlock
            icon="!"
            headingLevel={1}
            title="Staff access only"
            actions={
              <>
                <Link className={buttonClassName('primary')} to="/signin">
                  Sign in with a staff account
                </Link>
                <Link className={buttonClassName('secondary')} to="/">
                  Go to the public site
                </Link>
              </>
            }
          >
            This workspace shows the appointments assigned to one staff member.
            Customer accounts cannot open it.
          </StateBlock>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
