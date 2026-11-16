import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { login, loginWithDemoAccount, register } from '../mock/api'
import { errorMessage, useDocumentTitle } from '../lib/hooks'
import { Button, buttonClassName } from '../components/Button'
import { Card } from '../components/Card'
import { TextField } from '../components/Field'

type Mode = 'signin' | 'register'

export function SignInPage() {
  useDocumentTitle('Sign in')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next') || '/appointments'

  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') {
        await register({ name, email, password })
      } else {
        await login(email, password)
      }
      navigate(next, { replace: true })
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
          <h1>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
          <p className="lede">
            An account keeps your requests in one place. Guests can still book
            without one and cancel with the link in their email.
          </p>
        </div>

        <Card>
          <div className="segmented" style={{ marginBottom: 'var(--space-6)' }}>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={mode === 'signin'}
              onClick={() => {
                setMode('signin')
                setError(null)
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={mode === 'register'}
              onClick={() => {
                setMode('register')
                setError(null)
              }}
            >
              Create account
            </button>
          </div>

          <form className="stack" onSubmit={submit} noValidate>
            {mode === 'register' ? (
              <TextField
                label="Full name"
                required
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            ) : null}

            <TextField
              label="Email"
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <TextField
              label="Password"
              required
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              hint={
                mode === 'register'
                  ? 'At least 8 characters.'
                  : 'Staff accounts sign in here too, then set a new password in the staff workspace.'
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            {error ? (
              <div className="notice notice--error" role="alert">
                <div>
                  <div className="notice__title">We could not sign you in</div>
                  <p>{error}</p>
                </div>
              </div>
            ) : null}

            <Button type="submit" block disabled={busy}>
              {busy
                ? 'Please wait…'
                : mode === 'signin'
                  ? 'Sign in'
                  : 'Create account'}
            </Button>
          </form>

          <hr className="rule" style={{ marginBlock: 'var(--space-5)' }} />

          <div className="stack stack--tight">
            <span className="eyebrow">Demo</span>
            <p className="text-sm secondary">
              Sample customer: maria@example.com with the password
              slotly-demo. No real account is created.
            </p>
            <div className="row row--wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void loginWithDemoAccount()
                    .then(() => navigate(next, { replace: true }))
                    .catch((cause: unknown) => setError(errorMessage(cause)))
                }}
              >
                Use the sample account
              </Button>
              <Link className={buttonClassName('ghost', 'btn--sm')} to="/book">
                Book without an account
              </Link>
            </div>
          </div>
        </Card>

        <p className="meta">
          There is no self-service password reset in this version. Ask the
          business to reset a staff password.
        </p>
      </div>
    </div>
  )
}
