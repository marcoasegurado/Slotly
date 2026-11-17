import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'
import { resetRateLimits } from '../worker/auth/rate-limit'
import { renderAppointmentEmail } from '../worker/email/templates'
import type { EmailTransport } from '../worker/email/transport'
import {
  addDaysToDateKey,
  todayDateKey,
  unixSeconds,
  weekdayOfDateKey,
  zonedTimeToUtc,
} from '../worker/lib/time'
import { NotificationsRepository } from '../worker/repositories/notifications'
import {
  MAX_EMAIL_ATTEMPTS,
  attemptOutboxDelivery,
  deliverPendingEmails,
} from '../worker/services/notifications'
import type { AppointmentStatus } from '../worker/types'
import { createTestDatabase, type TestDatabase } from './helpers/test-d1'

const ORIGIN = 'http://localhost'
const MANILA = 'Asia/Manila'
const DEMO_PASSWORD = 'slotly-demo'
const RESEND_ENV = {
  EMAIL_TRANSPORT: 'resend',
  RESEND_API_KEY: 'test-key',
}
const MAX_REFERENCE = /^SLO-[A-Z2-9]{8}$/

interface RequestOptions {
  method?: string
  body?: unknown
  origin?: string | null
  cookie?: string
  env?: Record<string, unknown>
}

async function request(
  db: TestDatabase,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN
  if (options.cookie) headers.Cookie = options.cookie

  return await app.request(
    `${ORIGIN}${path}`,
    {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    { DB: db.d1, ENVIRONMENT: 'test', ...options.env },
  )
}

function sessionCookie(response: Response): string {
  const match = /(?:^|,\s*)slotly_session=([^;,]+)/.exec(
    response.headers.get('set-cookie') ?? '',
  )
  if (!match) throw new Error('Expected a slotly_session cookie.')
  return `slotly_session=${match[1]}`
}

async function login(db: TestDatabase, email: string): Promise<string> {
  const response = await request(db, '/api/auth/login', {
    body: { email, password: DEMO_PASSWORD },
  })
  expect(response.status).toBe(200)
  return sessionCookie(response)
}

function at(dateKey: string, minutes: number): number {
  return unixSeconds(zonedTimeToUtc(dateKey, minutes, MANILA).getTime())
}

function nextDateKey(weekdays: number[]): string {
  const today = todayDateKey(MANILA)
  for (let offset = 1; offset <= 14; offset += 1) {
    const dateKey = addDaysToDateKey(today, offset)
    if (weekdays.includes(weekdayOfDateKey(dateKey))) return dateKey
  }
  throw new Error('No matching weekday found within two weeks.')
}

const WEEKDAYS = [1, 2, 3, 4, 5]
const SHARED_WEEKDAYS = [2, 3, 4, 5]

interface AppointmentFixture {
  id: string
  reference: string
  customerUserId?: string | null
  guestName?: string | null
  guestEmail?: string | null
  staffUserId?: string
  startAt: number
  endAt: number
  status?: AppointmentStatus
}

function insertAppointment(db: TestDatabase, input: AppointmentFixture): void {
  const customerUserId =
    input.customerUserId === undefined ? 'usr_maria' : input.customerUserId
  const guestName =
    customerUserId === null ? (input.guestName ?? 'Guest Person') : null
  const guestEmail =
    customerUserId === null ? (input.guestEmail ?? 'guest@example.com') : null

  db.raw
    .prepare(
      `INSERT INTO appointments (
         id, public_reference, customer_user_id, guest_name, guest_email,
         service_id, service_name_snapshot, duration_minutes_snapshot,
         assigned_staff_user_id, start_at, end_at, status
       ) VALUES (?, ?, ?, ?, ?, 'svc_consult', 'Initial consultation', 60, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.reference,
      customerUserId,
      guestName,
      guestEmail,
      input.staffUserId ?? 'usr_ana',
      input.startAt,
      input.endAt,
      input.status ?? 'pending',
    )
}

function insertGuestToken(db: TestDatabase, appointmentId: string): void {
  const now = unixSeconds()
  db.raw
    .prepare(
      `INSERT INTO guest_cancellation_tokens (
         id, appointment_id, token_hash, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      `gct_${appointmentId}`,
      appointmentId,
      `hash_${appointmentId}`,
      now,
      now + 3 * 24 * 60 * 60,
    )
}

interface OutboxRow {
  id: string
  appointment_id: string
  event_type: string
  recipient_email: string
  payload_json: string
  delivery_status: string
  attempt_count: number
  last_error: string | null
  created_at: number
  sent_at: number | null
}

function outboxRows(db: TestDatabase): OutboxRow[] {
  return db.raw
    .prepare(
      `SELECT id, appointment_id, event_type, recipient_email, payload_json,
              delivery_status, attempt_count, last_error, created_at, sent_at
         FROM notification_outbox
        ORDER BY rowid ASC`,
    )
    .all() as unknown as OutboxRow[]
}

function appointmentStatus(db: TestDatabase, reference: string): string {
  const row = db.raw
    .prepare('SELECT status FROM appointments WHERE public_reference = ?')
    .get(reference) as { status: string } | undefined
  return row?.status ?? ''
}

function tokenInvalidatedAt(
  db: TestDatabase,
  appointmentId: string,
): number | null {
  const row = db.raw
    .prepare(
      `SELECT invalidated_at FROM guest_cancellation_tokens
        WHERE appointment_id = ?`,
    )
    .get(appointmentId) as { invalidated_at: number | null } | undefined
  return row?.invalidated_at ?? null
}

interface CapturedEmail {
  to: string[]
  subject: string
  text: string
  html: string
}

function captureResendSuccess(): CapturedEmail[] {
  const captured: CapturedEmail[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body ?? '{}')) as CapturedEmail)
      return new Response('{"id":"email_test"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return captured
}

function failResend(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('provider down', { status: 503 })),
  )
}

const successTransport: EmailTransport = {
  async send() {},
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  resetRateLimits()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('booking request email', () => {
  it('sends a guest request email with a cancellation link and purges the token', async () => {
    const calls = captureResendSuccess()
    const dateKey = nextDateKey(WEEKDAYS)
    const startAt = at(dateKey, 600)

    const response = await request(db, '/api/public/bookings', {
      body: {
        serviceId: 'svc_consult',
        startAt,
        guestName: 'Jamie Guest',
        guestEmail: 'JAMIE@Example.com',
      },
      env: RESEND_ENV,
    })
    expect(response.status).toBe(201)

    const body = (await response.json()) as {
      data: {
        appointment: { publicReference: string }
        cancellationToken: string
      }
    }
    const reference = body.data.appointment.publicReference
    const token = body.data.cancellationToken
    expect(reference).toMatch(MAX_REFERENCE)
    expect(JSON.stringify(body)).not.toContain('ntf_')

    expect(calls).toHaveLength(1)
    expect(calls[0].to).toEqual(['jamie@example.com'])
    expect(calls[0].subject).toContain(reference)
    expect(calls[0].text).toContain(`${ORIGIN}/cancel/${token}`)

    const rows = outboxRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event_type: 'request_received',
      recipient_email: 'jamie@example.com',
      delivery_status: 'sent',
      attempt_count: 1,
      last_error: null,
    })
    expect(rows[0].sent_at).toEqual(expect.any(Number))
    expect(rows[0].payload_json).not.toContain(token)
    expect(rows[0].payload_json).not.toContain('/cancel/')
  })

  it('uses the signed-in customer email and sends no cancellation link', async () => {
    const cookie = await login(db, 'maria@example.com')
    const calls = captureResendSuccess()
    const dateKey = nextDateKey(WEEKDAYS)

    const response = await request(db, '/api/public/bookings', {
      cookie,
      body: {
        serviceId: 'svc_consult',
        startAt: at(dateKey, 660),
        guestName: 'Ignored Guest',
        guestEmail: 'ignored@example.com',
      },
      env: RESEND_ENV,
    })
    expect(response.status).toBe(201)

    expect(calls).toHaveLength(1)
    expect(calls[0].to).toEqual(['maria@example.com'])
    expect(calls[0].text).not.toContain('/cancel/')

    const row = db.raw
      .prepare(
        `SELECT customer_user_id, guest_email FROM appointments
          WHERE public_reference = ?`,
      )
      .get(
        ((await response.json()) as { data: { appointment: { publicReference: string } } })
          .data.appointment.publicReference,
      ) as { customer_user_id: string | null; guest_email: string | null }
    expect(row).toEqual({ customer_user_id: 'usr_maria', guest_email: null })
  })
})

describe('appointment lifecycle email', () => {
  it('sends booking_confirmed on approval and invalidates the guest token', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const calls = captureResendSuccess()
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_confirm',
      reference: 'SLO-EMLCONF1',
      customerUserId: null,
      guestEmail: 'jamie@example.com',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
    })
    insertGuestToken(db, 'apt_confirm')

    const response = await request(
      db,
      '/api/staff/appointments/SLO-EMLCONF1/approve',
      { method: 'POST', cookie, env: RESEND_ENV },
    )
    expect(response.status).toBe(200)

    expect(calls).toHaveLength(1)
    expect(calls[0].to).toEqual(['jamie@example.com'])
    expect(calls[0].text).toContain('confirmed')

    const rows = outboxRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event_type: 'booking_confirmed',
      delivery_status: 'sent',
      attempt_count: 1,
    })
    expect(tokenInvalidatedAt(db, 'apt_confirm')).not.toBeNull()
    expect(appointmentStatus(db, 'SLO-EMLCONF1')).toBe('confirmed')
  })

  it('sends booking_update for rejection and rescheduling', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const calls = captureResendSuccess()
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_reject_mail',
      reference: 'SLO-EMLREJ01',
      customerUserId: null,
      guestEmail: 'reject@example.com',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
    })
    insertGuestToken(db, 'apt_reject_mail')
    insertAppointment(db, {
      id: 'apt_move_mail',
      reference: 'SLO-EMLMOVE1',
      customerUserId: null,
      guestEmail: 'move@example.com',
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
    })
    insertGuestToken(db, 'apt_move_mail')

    const rejected = await request(
      db,
      '/api/staff/appointments/SLO-EMLREJ01/reject',
      {
        method: 'POST',
        cookie,
        body: { reason: 'Fully booked' },
        env: RESEND_ENV,
      },
    )
    expect(rejected.status).toBe(200)

    const moved = await request(db, '/api/staff/appointments/SLO-EMLMOVE1', {
      method: 'PATCH',
      cookie,
      body: { startAt: at(dateKey, 780) },
      env: RESEND_ENV,
    })
    expect(moved.status).toBe(200)

    expect(calls).toHaveLength(2)

    const rows = outboxRows(db)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      appointment_id: 'apt_reject_mail',
      event_type: 'booking_update',
      delivery_status: 'sent',
    })
    expect(JSON.parse(rows[0].payload_json)).toMatchObject({
      action: 'rejected',
      resolutionNote: 'Fully booked',
    })
    expect(rows[1]).toMatchObject({
      appointment_id: 'apt_move_mail',
      event_type: 'booking_update',
      delivery_status: 'sent',
    })
    expect(JSON.parse(rows[1].payload_json)).toMatchObject({
      action: 'rescheduled',
      previousStartAt: at(dateKey, 720),
      previousEndAt: at(dateKey, 780),
    })

    // A pending reschedule keeps the guest link live.
    expect(tokenInvalidatedAt(db, 'apt_move_mail')).toBeNull()
  })

  it('sends booking_update on admin reassignment', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const calls = captureResendSuccess()
    const dateKey = nextDateKey(SHARED_WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_reassign_mail',
      reference: 'SLO-EMLREAS1',
      customerUserId: null,
      guestEmail: 'reassign@example.com',
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
    })

    const response = await request(
      db,
      '/api/admin/appointments/SLO-EMLREAS1/reassign',
      {
        method: 'POST',
        cookie,
        body: { staffId: 'usr_ben' },
        env: RESEND_ENV,
      },
    )
    expect(response.status).toBe(200)

    expect(calls).toHaveLength(1)
    const rows = outboxRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event_type: 'booking_update',
      delivery_status: 'sent',
    })
    expect(JSON.parse(rows[0].payload_json)).toMatchObject({
      action: 'reassigned',
      previousStartAt: at(dateKey, 720),
    })
  })
})

describe('email failure handling', () => {
  it('keeps the appointment change when delivery fails and retries later', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    failResend()
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_fail_mail',
      reference: 'SLO-EMLFAIL1',
      customerUserId: null,
      guestEmail: 'fail@example.com',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
    })

    const response = await request(
      db,
      '/api/staff/appointments/SLO-EMLFAIL1/approve',
      { method: 'POST', cookie, env: RESEND_ENV },
    )
    expect(response.status).toBe(200)
    expect(appointmentStatus(db, 'SLO-EMLFAIL1')).toBe('confirmed')

    const failed = outboxRows(db)[0]
    expect(failed).toMatchObject({
      event_type: 'booking_confirmed',
      delivery_status: 'failed',
      attempt_count: 1,
    })
    expect(failed.last_error).toContain('503')

    const sent = await attemptOutboxDelivery(
      { DB: db.d1, ENVIRONMENT: 'test' },
      failed.id,
      successTransport,
    )
    expect(sent).toBe(true)

    const retried = outboxRows(db)[0]
    expect(retried).toMatchObject({
      delivery_status: 'sent',
      attempt_count: 2,
      last_error: null,
    })
    expect(retried.sent_at).toEqual(expect.any(Number))
  })

  it('delivers multiple retryable rows from the scheduled job', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    failResend()
    const dateKey = nextDateKey(WEEKDAYS)

    for (const [index, reference] of ['SLO-EMLSCH01', 'SLO-EMLSCH02'].entries()) {
      insertAppointment(db, {
        id: `apt_sched_${index}`,
        reference,
        customerUserId: null,
        guestEmail: `retry${index}@example.com`,
        startAt: at(dateKey, 600 + index * 60),
        endAt: at(dateKey, 660 + index * 60),
        status: 'confirmed',
      })
      const response = await request(
        db,
        `/api/admin/appointments/${reference}/cancel`,
        { method: 'POST', cookie, env: RESEND_ENV },
      )
      expect(response.status).toBe(200)
    }

    expect(outboxRows(db).every((row) => row.delivery_status === 'failed')).toBe(
      true,
    )

    const summary = await deliverPendingEmails(
      { DB: db.d1, ENVIRONMENT: 'test' },
      new Date(),
      successTransport,
    )
    expect(summary).toEqual({ attempted: 2, sent: 2 })
    expect(outboxRows(db).every((row) => row.delivery_status === 'sent')).toBe(
      true,
    )
  })

  it('claims a row once and stops after the attempt limit', async () => {
    const now = unixSeconds()
    const repository = new NotificationsRepository(db.d1)
    insertAppointment(db, {
      id: 'apt_limits',
      reference: 'SLO-EMLLIM01',
      startAt: at(nextDateKey(WEEKDAYS), 600),
      endAt: at(nextDateKey(WEEKDAYS), 660),
    })

    await repository
      .statement({
        appointmentId: 'apt_limits',
        eventType: 'booking_update',
        recipientEmail: 'limits@example.com',
        payload: {},
        now,
      })
      .run()
    const id = outboxRows(db)[0].id

    expect(await repository.claim(id, now, MAX_EMAIL_ATTEMPTS, 900)).toBe(true)
    // Still `sending` and recent, so a second invocation cannot claim it.
    expect(await repository.claim(id, now, MAX_EMAIL_ATTEMPTS, 900)).toBe(false)

    // An attempt abandoned by a crash becomes reclaimable after the window.
    db.raw
      .prepare(
        'UPDATE notification_outbox SET last_attempt_at = ? WHERE id = ?',
      )
      .run(now - 901, id)
    expect(await repository.claim(id, now, MAX_EMAIL_ATTEMPTS, 900)).toBe(true)
    await repository.markFailed(id, 'boom')
    expect(outboxRows(db)[0].attempt_count).toBe(2)

    for (let attempt = 3; attempt <= MAX_EMAIL_ATTEMPTS; attempt += 1) {
      expect(await repository.claim(id, now, MAX_EMAIL_ATTEMPTS, 900)).toBe(true)
      await repository.markFailed(id, 'boom')
    }
    expect(await repository.claim(id, now, MAX_EMAIL_ATTEMPTS, 900)).toBe(false)
  })
})

describe('email templates', () => {
  it('renders the guest link, escapes HTML and shows the previous time', () => {
    const dateKey = '2026-12-01'
    const requestEmail = renderAppointmentEmail({
      eventType: 'request_received',
      businessName: 'Slotly <Studio>',
      businessEmail: 'hello@example.com',
      timezone: MANILA,
      publicReference: 'SLO-TEST0001',
      serviceName: 'Initial consultation',
      durationMinutes: 60,
      startAt: at(dateKey, 540),
      endAt: at(dateKey, 600),
      recipientName: 'Jamie <Guest>',
      customerNote: null,
      resolutionNote: null,
      payload: { cancellationUrl: 'https://example.com/cancel/abc123' },
    })

    expect(requestEmail.subject).toContain('SLO-TEST0001')
    expect(requestEmail.text).toContain('https://example.com/cancel/abc123')
    expect(requestEmail.text).toContain('pending')
    expect(requestEmail.html).toContain('https://example.com/cancel/abc123')
    expect(requestEmail.html).toContain('Slotly &lt;Studio&gt;')
    expect(requestEmail.html).toContain('Jamie &lt;Guest&gt;')

    const updateEmail = renderAppointmentEmail({
      eventType: 'booking_update',
      businessName: 'Slotly',
      businessEmail: null,
      timezone: MANILA,
      publicReference: 'SLO-TEST0002',
      serviceName: 'Initial consultation',
      durationMinutes: 60,
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      recipientName: 'Jamie Guest',
      customerNote: null,
      resolutionNote: null,
      payload: {
        action: 'rescheduled',
        previousStartAt: at(dateKey, 600),
        previousEndAt: at(dateKey, 660),
      },
    })

    expect(updateEmail.subject).toContain('updated')
    expect(updateEmail.text).toContain('Previous time')
    expect(updateEmail.text).toContain('SLO-TEST0002')
  })
})
