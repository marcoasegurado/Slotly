import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { updatePassword } from '../lib/session'
import { errorMessage, useDocumentTitle, useSession } from '../lib/hooks'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { TextField } from '../components/Field'

/** Where a user lands after setting their own password. */
function landingPath(role: 'customer' | 'staff' | 'admin'): string {
  if (role === 'staff') return '/staff'
  if (role === 'admin') return '/admin'
  return '/appointments'
}

/**
 * Sets a new password, and is required before a staff account issued a
 * temporary password can use the workspace. The Worker enforces the same rule
 * on every staff endpoint, so this page is convenience, not authorization.
 */
export function ChangePasswordPage() {
  useDocumentTitle('Change password')
  const navigate = useNavigate()
  const session = useSession()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!session) {
    return <Navigate to="/signin?next=%2Fchange-password" replace />
  }

  const forced = session.mustChangePassword

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    if (newPassword.length < 8) {
      setError('Use at least 8 characters for your new password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setError('Choose a password that is different from the current one.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const user = await updatePassword({ currentPassword, newPassword })
      navigate(landingPath(user.role), { replace: true })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container main--narrow">
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <span className="eyebrow">Account</span>
          <h1>{forced ? 'Set your own password' : 'Change password'}</h1>
          <p className="lede">
            {forced
              ? 'This account was created with a temporary password. Choose your own before continuing.'
              : 'Choose a new password for your account. Other sessions are signed out.'}
          </p>
        </div>

        <Card>
          <form className="stack" onSubmit={submit} noValidate>
            <TextField
              label={forced ? 'Temporary password' : 'Current password'}
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />

            <TextField
              label="New password"
              required
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters."
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />

            <TextField
              label="Confirm new password"
              required
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />

            {error ? (
              <div className="notice notice--error" role="alert">
                <div>
                  <div className="notice__title">We could not change it</div>
                  <p>{error}</p>
                </div>
              </div>
            ) : null}

            <Button type="submit" block disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
