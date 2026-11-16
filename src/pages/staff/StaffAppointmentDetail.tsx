import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  approveStaffAppointment,
  cancelStaffAppointment,
  getStaffAppointment,
  rejectStaffAppointment,
} from '../../mock/api'
import { validateStaffSlotForDuration } from '../../lib/availability'
import {
  errorMessage,
  useAsync,
  useDocumentTitle,
  useMockDb,
  useSession,
} from '../../lib/hooks'
import {
  formatDateKey,
  formatDuration,
  formatTimeRange,
  toDateKey,
} from '../../lib/time'
import { Button, buttonClassName } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { Dialog } from '../../components/Dialog'
import { TextAreaField } from '../../components/Field'
import { StateBlock } from '../../components/StateBlock'
import { StatusTag } from '../../components/StatusTag'

type DialogKind = 'reject' | 'cancel' | null

export function StaffAppointmentDetailPage() {
  useDocumentTitle('Appointment review')
  const { id = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const db = useMockDb()
  const session = useSession()

  const appointment = useAsync(() => getStaffAppointment(id), [db, id])
  const [actionError, setActionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [reason, setReason] = useState('')

  const record = appointment.data

  if (appointment.loading && !record) {
    return (
      <div className="workspace-page">
        <Card>
          <div className="skeleton-row">
            <div className="skeleton" style={{ width: '35%' }} />
            <div className="skeleton" style={{ width: '75%' }} />
            <div className="skeleton" style={{ width: '55%' }} />
          </div>
        </Card>
      </div>
    )
  }

  if (appointment.error || !record) {
    return (
      <div className="workspace-page">
        <Card>
          <StateBlock
            icon="?"
            title="That appointment is not available"
            actions={
              <Link className={buttonClassName('primary')} to="/staff/appointments">
                Back to appointments
              </Link>
            }
          >
            It may belong to another staff member or may no longer exist.
          </StateBlock>
        </Card>
      </div>
    )
  }

  const staff = db.staff.find((entry) => entry.id === session?.id) ?? null
  const businessDateKey = toDateKey(new Date(record.startAt), db.business.timezone)
  const now = new Date()
  const isPast = Date.parse(record.startAt) <= now.getTime()
  const hasConflict =
    staff !== null &&
    record.status === 'pending' &&
    !isPast &&
    validateStaffSlotForDuration(
      {
        business: db.business,
        staff: db.staff,
        appointments: db.appointments,
      },
      staff,
      record.startAt,
      record.durationMinutesSnapshot,
      now,
      record.id,
    ) === null

  const canApprove = record.status === 'pending' && !isPast && !hasConflict

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return false
    setBusy(true)
    setActionError(null)
    setSuccess(null)
    try {
      await action()
      setSuccess(message)
      return true
    } catch (cause) {
      setActionError(errorMessage(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  const closeDialog = () => {
    if (busy) return
    setDialog(null)
    setReason('')
    setActionError(null)
  }

  return (
    <div className="workspace-page stack stack--loose">
      <Link className="text-sm" to="/staff/appointments">
        ← Back to appointments
      </Link>

      <div className="row row--between row--wrap">
        <div className="stack stack--tight">
          <span className="eyebrow">Appointment review</span>
          <h1 style={{ fontSize: '2rem' }}>{record.serviceNameSnapshot}</h1>
          <p className="lede">
            {formatDateKey(businessDateKey)} ·{' '}
            {formatTimeRange(record.startAt, record.endAt, db.business.timezone)}
          </p>
        </div>
        <StatusTag status={record.status} />
      </div>

      {actionError && dialog === null ? (
        <div className="notice notice--error" role="alert">
          <div>
            <div className="notice__title">That did not work</div>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}

      {success ? (
        <div className="notice notice--success" role="status">
          <div>
            <div className="notice__title">{success}</div>
            <p>The appointment record has been updated.</p>
          </div>
        </div>
      ) : null}

      {record.status === 'pending' && isPast ? (
        <div className="notice notice--warning">
          <div>
            <div className="notice__title">This request cannot be approved</div>
            <p>
              Its start time has passed. Decline it, or reschedule it to a future
              time in your schedule if the customer still needs the appointment.
            </p>
          </div>
        </div>
      ) : null}

      {record.status === 'pending' && !isPast && hasConflict ? (
        <div className="notice notice--warning">
          <div>
            <div className="notice__title">This request conflicts with your schedule</div>
            <p>
              The requested time overlaps a confirmed booking, time off, or falls
              outside your working hours. Approve stays blocked. Choose another
              time or decline the request.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid-2">
        <div className="stack stack--loose">
          <Card>
            <CardHeader title="Details" />
            <dl className="definition">
              <dt>Reference</dt>
              <dd className="mono">{record.publicReference}</dd>

              <dt>Service</dt>
              <dd>{record.serviceNameSnapshot}</dd>

              <dt>Duration</dt>
              <dd className="mono">{formatDuration(record.durationMinutesSnapshot)}</dd>

              <dt>Date</dt>
              <dd>{formatDateKey(businessDateKey)}</dd>

              <dt>Time</dt>
              <dd className="mono">
                {formatTimeRange(record.startAt, record.endAt, db.business.timezone)}
              </dd>

              <dt>Assigned to</dt>
              <dd>{session?.name ?? 'You'}</dd>

              <dt>Customer</dt>
              <dd>{record.guestName ?? 'Customer'}</dd>

              <dt>Email</dt>
              <dd>{record.guestEmail}</dd>

              <dt>Customer note</dt>
              <dd>{record.customerNote ?? 'None'}</dd>

              {record.resolutionNote ? (
                <>
                  <dt>Resolution note</dt>
                  <dd>{record.resolutionNote}</dd>
                </>
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Status" />
            <ol className="timeline">
              <li className="timeline__item timeline__item--done">
                <span className="timeline__dot" aria-hidden="true" />
                <div>
                  <div className="timeline__label">Requested</div>
                  <div className="timeline__note">
                    Sent {new Date(record.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </li>
              <li
                className={`timeline__item ${
                  record.status === 'pending'
                    ? 'timeline__item--current'
                    : 'timeline__item--done'
                }`}
              >
                <span className="timeline__dot" aria-hidden="true" />
                <div>
                  <div className="timeline__label">Review</div>
                  <div className="timeline__note">
                    Approval rechecks working hours, time off and confirmed
                    overlaps immediately before it commits.
                  </div>
                </div>
              </li>
              <li
                className={`timeline__item ${
                  record.status === 'confirmed' ? 'timeline__item--done' : ''
                }`}
              >
                <span className="timeline__dot" aria-hidden="true" />
                <div>
                  <div className="timeline__label">
                    {record.status === 'confirmed'
                      ? 'Confirmed'
                      : record.status === 'rejected'
                        ? 'Declined'
                        : record.status === 'cancelled'
                          ? 'Cancelled'
                          : 'Decision'}
                  </div>
                  <div className="timeline__note">
                    {record.status === 'pending'
                      ? 'The customer is emailed either way.'
                      : record.resolutionNote ?? 'The status is final.'}
                  </div>
                </div>
              </li>
            </ol>
          </Card>
        </div>

        <aside className="stack stack--loose">
          <Card>
            <CardHeader title="Actions" />
            <div className="stack">
              {record.status === 'pending' ? (
                <>
                  <Button
                    block
                    disabled={!canApprove || busy}
                    onClick={() => {
                      void runAction(
                        () => approveStaffAppointment(record.id),
                        'Request approved',
                      )
                    }}
                  >
                    {busy ? 'Working…' : 'Approve request'}
                  </Button>
                  <Link
                    className={buttonClassName('secondary', 'btn--block')}
                    to={`/staff/appointments/${record.id}/reschedule`}
                  >
                    Reschedule within my schedule
                  </Link>
                  <Button
                    variant="danger"
                    block
                    disabled={busy}
                    onClick={() => {
                      setActionError(null)
                      setDialog('reject')
                    }}
                  >
                    Decline request
                  </Button>
                </>
              ) : null}

              {record.status === 'confirmed' ? (
                <>
                  <Link
                    className={buttonClassName('secondary', 'btn--block')}
                    to={`/staff/appointments/${record.id}/reschedule`}
                  >
                    Reschedule within my schedule
                  </Link>
                  <Button
                    variant="danger"
                    block
                    disabled={busy}
                    onClick={() => {
                      setActionError(null)
                      setDialog('cancel')
                    }}
                  >
                    Cancel appointment
                  </Button>
                </>
              ) : null}

              {record.status === 'rejected' || record.status === 'cancelled' ? (
                <p className="secondary text-sm">
                  This appointment is closed. No further action is available.
                </p>
              ) : null}

              <p className="meta">
                Staff cannot reassign an appointment to another staff member. An
                admin must handle reassignment.
              </p>

              <hr className="rule" />

              <Button
                variant="ghost"
                block
                onClick={() => navigate('/staff/appointments')}
              >
                Back to queue
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      <Dialog
        open={dialog === 'reject'}
        title="Decline this request?"
        onClose={closeDialog}
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={busy}>
              Keep it pending
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                void runAction(
                  () => rejectStaffAppointment(record.id, reason),
                  'Request declined',
                ).then((ok) => {
                  if (!ok) return
                  setDialog(null)
                  setReason('')
                })
              }}
            >
              {busy ? 'Declining…' : 'Decline request'}
            </Button>
          </>
        }
      >
        <span>
          {record.serviceNameSnapshot} · {record.publicReference}
          <br />
          The customer will be notified that the request was not confirmed.
        </span>
        <TextAreaField
          label="Reason (optional)"
          hint="Shown to the customer in the update."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={320}
        />
        {actionError ? (
          <p className="field__error" role="alert">
            {actionError}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={dialog === 'cancel'}
        title="Cancel this appointment?"
        onClose={closeDialog}
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={busy}>
              Keep appointment
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                void runAction(
                  () => cancelStaffAppointment(record.id, reason),
                  'Appointment cancelled',
                ).then((ok) => {
                  if (!ok) return
                  setDialog(null)
                  setReason('')
                })
              }}
            >
              {busy ? 'Cancelling…' : 'Cancel appointment'}
            </Button>
          </>
        }
      >
        <span>
          {record.serviceNameSnapshot} · {record.publicReference}
          <br />
          This removes a confirmed booking and notifies the customer. It cannot be
          undone.
        </span>
        <TextAreaField
          label="Reason (optional)"
          hint="Shown to the customer in the update."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={320}
        />
        {actionError ? (
          <p className="field__error" role="alert">
            {actionError}
          </p>
        ) : null}
      </Dialog>
    </div>
  )
}
