import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  listActiveStaff,
  type ActiveStaffMember,
  type ManagedAppointment,
} from '../../lib/api'
import { type ManagementArea, managementFor } from '../../lib/manage'
import {
  errorMessage,
  useAsync,
  useBusiness,
  useDocumentTitle,
} from '../../lib/hooks'
import {
  formatDateKey,
  formatDuration,
  formatTimeRange,
  minutesOfDay,
  minutesToTimeInput,
  parseTimeInput,
  toDateKey,
  zonedParts,
  zonedTimeToUtc,
} from '../../lib/time'
import { Button, buttonClassName } from '../../components/Button'
import { Card, CardHeader } from '../../components/Card'
import { Dialog } from '../../components/Dialog'
import { SelectField, TextAreaField, TextField } from '../../components/Field'
import { StateBlock } from '../../components/StateBlock'
import { StatusTag } from '../../components/StatusTag'

type DialogKind = 'reject' | 'cancel' | null

interface AppointmentDetailPageProps {
  area: ManagementArea
}

export function AppointmentDetailPage({ area }: AppointmentDetailPageProps) {
  const manage = managementFor(area)
  const { reference = '' } = useParams()
  const navigate = useNavigate()
  const business = useBusiness()
  const timezone = business.timezone

  useDocumentTitle(area === 'admin' ? 'Appointment' : 'Appointment review')

  const appointment = useAsync(() => manage.get(reference), [area, reference])
  const record = appointment.data

  const [actionError, setActionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [reason, setReason] = useState('')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)

  const staff = useAsync<ActiveStaffMember[]>(
    () => (manage.canReassign ? listActiveStaff() : Promise.resolve([])),
    [area],
  )
  const [reassignStaffId, setReassignStaffId] = useState('')

  useEffect(() => {
    if (!record) return
    const parts = zonedParts(new Date(record.startAt * 1000), timezone)
    const dateKey = toDateKey(new Date(record.startAt * 1000), timezone)
    setRescheduleDate(dateKey)
    setRescheduleTime(
      minutesToTimeInput(parts.hour * 60 + parts.minute),
    )
    setReassignStaffId(record.assignedStaff.id)
  }, [record, timezone])

  if (appointment.loading && !record) {
    return (
      <div className="workspace-page">
        <Card>
          <h1 className="visually-hidden">Appointment</h1>
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
            headingLevel={1}
            title="That appointment is not available"
            actions={
              <Link className={buttonClassName('primary')} to={manage.basePath}>
                Back to appointments
              </Link>
            }
          >
            {area === 'staff'
              ? 'It may belong to another staff member or may no longer exist.'
              : 'It may no longer exist. Check the reference and try again.'}
          </StateBlock>
        </Card>
      </div>
    )
  }

  const businessDateKey = toDateKey(new Date(record.startAt * 1000), timezone)
  const isPast = record.startAt * 1000 <= Date.now()
  const canDecide = record.status === 'pending'
  const canCancel =
    record.status === 'confirmed' || (area === 'admin' && record.status === 'pending')
  const canReschedule =
    record.status === 'pending' || record.status === 'confirmed'
  const customerLabel = record.customer?.name ?? record.guestName ?? 'Customer'
  const customerEmail = record.customer?.email ?? record.guestEmail ?? '—'

  const runAction = async (
    key: string,
    action: () => Promise<ManagedAppointment>,
    message: string,
  ): Promise<boolean> => {
    if (busy) return false
    setBusy(key)
    setActionError(null)
    setSuccess(null)
    try {
      await action()
      setSuccess(message)
      appointment.reload()
      return true
    } catch (cause) {
      setActionError(errorMessage(cause))
      return false
    } finally {
      setBusy(null)
    }
  }

  const rescheduleStartAt = (): number | null => {
    const minutes = parseTimeInput(rescheduleTime)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rescheduleDate) || minutes === null) {
      setRescheduleError('Choose both a date and a time.')
      return null
    }
    return Math.floor(
      zonedTimeToUtc(rescheduleDate, minutes, timezone).getTime() / 1000,
    )
  }

  return (
    <div className="workspace-page stack stack--loose">
      <Link className="text-sm" to={manage.basePath}>
        ← Back to appointments
      </Link>

      <div className="row row--between row--wrap">
        <div className="stack stack--tight">
          <span className="eyebrow">
            {area === 'admin' ? 'Admin review' : 'Appointment review'}
          </span>
          <h1 style={{ fontSize: '2rem' }}>{record.serviceName}</h1>
          <p className="lede">
            {formatDateKey(businessDateKey)} ·{' '}
            {formatTimeRange(
              new Date(record.startAt * 1000).toISOString(),
              new Date(record.endAt * 1000).toISOString(),
              timezone,
            )}
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
              time if the customer still needs the appointment.
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
              <dd>{record.serviceName}</dd>

              <dt>Duration</dt>
              <dd className="mono">{formatDuration(record.durationMinutes)}</dd>

              <dt>Date</dt>
              <dd>{formatDateKey(businessDateKey)}</dd>

              <dt>Time</dt>
              <dd className="mono">
                {formatTimeRange(
                  new Date(record.startAt * 1000).toISOString(),
                  new Date(record.endAt * 1000).toISOString(),
                  timezone,
                )}
              </dd>

              <dt>Assigned to</dt>
              <dd>{record.assignedStaff.name}</dd>

              <dt>Customer</dt>
              <dd>{customerLabel}</dd>

              <dt>Email</dt>
              <dd>{customerEmail}</dd>

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
            <CardHeader title="Timeline" />
            <ol className="timeline">
              <li className="timeline__item timeline__item--done">
                <span className="timeline__dot" aria-hidden="true" />
                <div>
                  <div className="timeline__label">Requested</div>
                  <div className="timeline__note">
                    Sent{' '}
                    {new Date(record.createdAt * 1000).toLocaleDateString()}
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
              {canDecide ? (
                <Button
                  block
                  disabled={isPast || busy !== null}
                  onClick={() => {
                    void runAction(
                      'approve',
                      () => manage.approve(record.publicReference),
                      'Appointment confirmed',
                    )
                  }}
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve appointment'}
                </Button>
              ) : null}

              {canDecide ? (
                <Button
                  block
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    setReason('')
                    setActionError(null)
                    setDialog('reject')
                  }}
                >
                  Decline request
                </Button>
              ) : null}

              {canCancel ? (
                <Button
                  block
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() => {
                    setReason('')
                    setActionError(null)
                    setDialog('cancel')
                  }}
                >
                  {record.status === 'pending'
                    ? 'Cancel pending request'
                    : 'Cancel appointment'}
                </Button>
              ) : null}

              {!canDecide && !canCancel ? (
                <p className="secondary text-sm">
                  This appointment is {record.status}. No further action is
                  available for this status.
                </p>
              ) : null}

              <p className="meta">
                Approving sends a confirmation email. Declining or cancelling
                sends an update email.
              </p>
            </div>
          </Card>

          {canReschedule ? (
            <Card>
              <CardHeader title="Reschedule" />
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault()
                  setRescheduleError(null)
                  const startAt = rescheduleStartAt()
                  if (startAt === null) return
                  if (startAt * 1000 <= Date.now()) {
                    setRescheduleError('Choose a time in the future.')
                    return
                  }
                  void runAction(
                    'reschedule',
                    () => manage.reschedule(record.publicReference, startAt),
                    'Appointment rescheduled',
                  )
                }}
              >
                <p className="text-sm secondary">
                  Moves this {formatDuration(record.durationMinutes)} appointment
                  within {record.assignedStaff.name}'s schedule. Times are in{' '}
                  {timezone.replace('_', ' ')}.
                </p>
                <div className="row" style={{ gap: 'var(--space-3)' }}>
                  <TextField
                    label="Date"
                    type="date"
                    required
                    value={rescheduleDate}
                    onChange={(event) => setRescheduleDate(event.target.value)}
                  />
                  <TextField
                    label="Start time"
                    type="time"
                    required
                    step={900}
                    value={rescheduleTime}
                    onChange={(event) => setRescheduleTime(event.target.value)}
                  />
                </div>
                <p className="meta">
                  Current start:{' '}
                  {minutesToTimeInput(
                    minutesOfDay(new Date(record.startAt * 1000), timezone),
                  )}{' '}
                  on {formatDateKey(businessDateKey)}
                </p>
                {rescheduleError ? (
                  <p className="field__error" role="alert">
                    {rescheduleError}
                  </p>
                ) : null}
                <Button type="submit" variant="secondary" disabled={busy !== null}>
                  {busy === 'reschedule' ? 'Saving…' : 'Move appointment'}
                </Button>
              </form>
            </Card>
          ) : null}

          {manage.canReassign ? (
            <Card>
              <CardHeader title="Reassign staff" />
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!reassignStaffId) return
                  void runAction(
                    'reassign',
                    () =>
                      manage.reassign(
                        record.publicReference,
                        reassignStaffId,
                      ),
                    'Appointment reassigned',
                  )
                }}
              >
                <SelectField
                  label="Assigned staff member"
                  value={reassignStaffId}
                  onChange={(event) => setReassignStaffId(event.target.value)}
                  disabled={staff.loading || busy !== null}
                >
                  {(staff.data ?? []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </SelectField>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={
                    busy !== null ||
                    !reassignStaffId ||
                    reassignStaffId === record.assignedStaff.id
                  }
                >
                  {busy === 'reassign' ? 'Moving…' : 'Reassign'}
                </Button>
                <p className="meta">
                  Reassignment rechecks the new staff member's hours, time off and
                  confirmed bookings. A conflict is refused, never forced.
                </p>
              </form>
            </Card>
          ) : null}
        </aside>
      </div>

      <Dialog
        open={dialog !== null}
        title={
          dialog === 'reject' ? 'Decline this request?' : 'Cancel this appointment?'
        }
        onClose={() => {
          if (busy) return
          setDialog(null)
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDialog(null)}
              disabled={busy !== null}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                if (dialog === null) return
                const kind = dialog
                void runAction(
                  kind,
                  () =>
                    kind === 'reject'
                      ? manage.reject(record.publicReference, reason.trim() || null)
                      : manage.cancel(record.publicReference, reason.trim() || null),
                  kind === 'reject' ? 'Request declined' : 'Appointment cancelled',
                ).then((ok) => {
                  if (ok) setDialog(null)
                })
              }}
            >
              {busy === 'reject' || busy === 'cancel'
                ? 'Saving…'
                : dialog === 'reject'
                  ? 'Decline request'
                  : 'Cancel appointment'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <p>
            {dialog === 'reject'
              ? 'The customer is emailed that the request was declined.'
              : 'The customer is emailed that the appointment was cancelled.'}
          </p>
          <TextAreaField
            label="Reason (optional)"
            hint="Included in the email to the customer."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
          />
          {actionError ? (
            <p className="field__error" role="alert">
              {actionError}
            </p>
          ) : null}
        </div>
      </Dialog>

      {area === 'admin' ? (
        <div className="row row--wrap">
          <Button
            variant="ghost"
            onClick={() => navigate(manage.basePath)}
            disabled={busy !== null}
          >
            Back to all appointments
          </Button>
        </div>
      ) : null}
    </div>
  )
}
