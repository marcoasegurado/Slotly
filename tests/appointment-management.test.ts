import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/app'
import { resetRateLimits } from '../worker/auth/rate-limit'
import { AppointmentsRepository } from '../worker/repositories/appointments'
import {
  addDaysToDateKey,
  todayDateKey,
  unixSeconds,
  weekdayOfDateKey,
  zonedTimeToUtc,
} from '../worker/lib/time'
import { createTestDatabase, type TestDatabase } from './helpers/test-d1'
import type { AppointmentStatus } from '../worker/types'

const ORIGIN = 'http://localhost'
const MANILA = 'Asia/Manila'
const DEMO_PASSWORD = 'slotly-demo'

interface RequestOptions {
  method?: string
  body?: unknown
  origin?: string | null
  cookie?: string
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
    { DB: db.d1, ENVIRONMENT: 'test' },
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

async function expectApiError(
  response: Response,
  status: number,
  code: string,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status)
  const body = (await response.json()) as {
    error: { code: string; message: string; details: Record<string, unknown> }
  }
  expect(body.error.code).toBe(code)
  return body.error
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
  serviceId?: string
  durationMinutes?: number
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
       ) VALUES (?, ?, ?, ?, ?, ?, 'Initial consultation', ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.reference,
      customerUserId,
      guestName,
      guestEmail,
      input.serviceId ?? 'svc_consult',
      input.durationMinutes ?? 60,
      input.staffUserId ?? 'usr_ana',
      input.startAt,
      input.endAt,
      input.status ?? 'pending',
    )
}

function insertGuestToken(
  db: TestDatabase,
  appointmentId: string,
  now = unixSeconds(),
): void {
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

function appointmentRow(db: TestDatabase, reference: string) {
  return db.raw
    .prepare(
      `SELECT id, status, start_at, end_at, assigned_staff_user_id,
              resolution_note, approved_at, approved_by_user_id,
              cancelled_at, cancelled_by_user_id
         FROM appointments
        WHERE public_reference = ?`,
    )
    .get(reference) as
    | {
        id: string
        status: AppointmentStatus
        start_at: number
        end_at: number
        assigned_staff_user_id: string
        resolution_note: string | null
        approved_at: number | null
        approved_by_user_id: string | null
        cancelled_at: number | null
        cancelled_by_user_id: string | null
      }
    | undefined
}

function tokenRow(db: TestDatabase, appointmentId: string) {
  return db.raw
    .prepare(
      `SELECT invalidated_at, used_at
         FROM guest_cancellation_tokens
        WHERE appointment_id = ?`,
    )
    .get(appointmentId) as
    | { invalidated_at: number | null; used_at: number | null }
    | undefined
}

function auditRows(db: TestDatabase) {
  return db.raw
    .prepare(
      `SELECT actor_user_id, action, entity_type, entity_id, metadata_json
         FROM audit_logs
        ORDER BY rowid ASC`,
    )
    .all() as Array<{
    actor_user_id: string | null
    action: string
    entity_type: string
    entity_id: string | null
    metadata_json: string
  }>
}

async function bodyData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data: T }
  return body.data
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  resetRateLimits()
})

describe('staff appointment dashboard and lists', () => {
  it('partitions only the signed-in staff member’s appointments', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)
    const today = todayDateKey(MANILA)

    insertAppointment(db, {
      id: 'apt_pending',
      reference: 'SLO-PENDING1',
      staffUserId: 'usr_ana',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertAppointment(db, {
      id: 'apt_confirmed',
      reference: 'SLO-CONFIRM1',
      staffUserId: 'usr_ana',
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
      status: 'confirmed',
    })
    insertAppointment(db, {
      id: 'apt_today',
      reference: 'SLO-TODAY001',
      staffUserId: 'usr_ana',
      startAt: at(today, 0),
      endAt: at(today, 0) + 60,
      status: 'confirmed',
    })
    insertAppointment(db, {
      id: 'apt_ben',
      reference: 'SLO-BENONLY1',
      staffUserId: 'usr_ben',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'pending',
    })

    const response = await request(db, '/api/staff/dashboard', { cookie })
    expect(response.status).toBe(200)
    const data = await bodyData<{
      pending: Array<{ publicReference: string }>
      today: Array<{ publicReference: string }>
      upcoming: Array<{ publicReference: string }>
      counts: { pending: number; today: number; confirmedUpcoming: number }
    }>(response)

    expect(data.pending.map((entry) => entry.publicReference)).toEqual([
      'SLO-PENDING1',
    ])
    expect(data.today.map((entry) => entry.publicReference)).toEqual([
      'SLO-TODAY001',
    ])
    expect(data.upcoming.map((entry) => entry.publicReference)).toEqual([
      'SLO-CONFIRM1',
    ])
    expect(data.counts).toEqual({
      pending: 1,
      today: 1,
      confirmedUpcoming: 1,
    })
    expect(JSON.stringify(data)).not.toContain('SLO-BENONLY1')
  })

  it('filters own appointments and hides another staff member’s booking', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_a_pending',
      reference: 'SLO-APEND001',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertAppointment(db, {
      id: 'apt_a_confirmed',
      reference: 'SLO-ACONF001',
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
      status: 'confirmed',
    })
    insertAppointment(db, {
      id: 'apt_a_rejected',
      reference: 'SLO-AREJ0001',
      startAt: at(dateKey, 840),
      endAt: at(dateKey, 900),
      status: 'rejected',
    })
    insertAppointment(db, {
      id: 'apt_b',
      reference: 'SLO-BPEND001',
      staffUserId: 'usr_ben',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'pending',
    })

    const pendingResponse = await request(
      db,
      '/api/staff/appointments?status=pending',
      { cookie },
    )
    expect(pendingResponse.status).toBe(200)
    const pending = await bodyData<Array<{ publicReference: string }>>(
      pendingResponse,
    )
    expect(pending.map((entry) => entry.publicReference)).toEqual([
      'SLO-APEND001',
    ])

    const upcomingResponse = await request(
      db,
      '/api/staff/appointments?scope=upcoming',
      { cookie },
    )
    expect(upcomingResponse.status).toBe(200)
    const upcoming = await bodyData<Array<{ publicReference: string }>>(
      upcomingResponse,
    )
    expect(upcoming.map((entry) => entry.publicReference)).toEqual([
      'SLO-APEND001',
      'SLO-ACONF001',
    ])

    const detailResponse = await request(
      db,
      '/api/staff/appointments/SLO-APEND001',
      { cookie },
    )
    expect(detailResponse.status).toBe(200)
    const detail = await bodyData<Record<string, unknown>>(detailResponse)
    expect(detail).toMatchObject({
      publicReference: 'SLO-APEND001',
      status: 'pending',
      assignedStaff: {
        id: 'usr_ana',
        name: 'Ana Reyes',
        email: 'ana@slotly.studio',
      },
      customer: { name: 'Maria Santos', email: 'maria@example.com' },
    })
    expect(detail).not.toHaveProperty('id')
    expect(detail).not.toHaveProperty('assignedStaffUserId')

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-BPEND001', { cookie }),
      404,
      'APPOINTMENT_NOT_FOUND',
    )
  })
})

describe('staff approval', () => {
  it('approves a pending guest request, invalidates its token and audits it', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)
    const startAt = at(dateKey, 600)
    const endAt = at(dateKey, 660)

    insertAppointment(db, {
      id: 'apt_guest',
      reference: 'SLO-GUEST001',
      customerUserId: null,
      guestName: 'Jamie Guest',
      guestEmail: 'jamie@example.com',
      startAt,
      endAt,
      status: 'pending',
    })
    insertGuestToken(db, 'apt_guest')

    const response = await request(
      db,
      '/api/staff/appointments/SLO-GUEST001/approve',
      { method: 'POST', cookie },
    )
    expect(response.status).toBe(200)
    const data = await bodyData<Record<string, unknown>>(response)
    expect(data).toMatchObject({
      publicReference: 'SLO-GUEST001',
      status: 'confirmed',
      resolutionNote: 'Approved',
      startAt,
      endAt,
      guestName: 'Jamie Guest',
      guestEmail: 'jamie@example.com',
      customer: null,
    })
    expect(typeof data.approvedAt).toBe('number')

    const row = appointmentRow(db, 'SLO-GUEST001')
    expect(row).toMatchObject({
      status: 'confirmed',
      approved_by_user_id: 'usr_ana',
      resolution_note: 'Approved',
    })
    expect(row?.approved_at).not.toBeNull()
    expect(tokenRow(db, 'apt_guest')).toMatchObject({
      invalidated_at: expect.any(Number),
      used_at: null,
    })

    const audits = auditRows(db)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actor_user_id: 'usr_ana',
      action: 'appointment.approved',
      entity_type: 'appointment',
      entity_id: 'SLO-GUEST001',
    })
  })

  it('refuses approval when a confirmed appointment overlaps', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_pending',
      reference: 'SLO-PEND0001',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertGuestToken(db, 'apt_pending')
    insertAppointment(db, {
      id: 'apt_confirmed',
      reference: 'SLO-CONF0001',
      startAt: at(dateKey, 630),
      endAt: at(dateKey, 690),
      status: 'confirmed',
    })

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-PEND0001/approve', {
        method: 'POST',
        cookie,
      }),
      409,
      'BOOKING_CONFLICT',
    )

    expect(appointmentRow(db, 'SLO-PEND0001')?.status).toBe('pending')
    expect(tokenRow(db, 'apt_pending')?.invalidated_at).toBeNull()
    expect(auditRows(db)).toHaveLength(0)
  })

  it('refuses approval outside working hours, during time off or after the start', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_late',
      reference: 'SLO-LATE0001',
      startAt: at(dateKey, 1080),
      endAt: at(dateKey, 1140),
      status: 'pending',
    })
    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-LATE0001/approve', {
        method: 'POST',
        cookie,
      }),
      409,
      'BOOKING_CONFLICT',
    )

    insertAppointment(db, {
      id: 'apt_timeoff',
      reference: 'SLO-TIMEOFF1',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    db.raw
      .prepare(
        `INSERT INTO staff_time_off (id, staff_user_id, start_at, end_at, reason)
         VALUES ('tof_test', 'usr_ana', ?, ?, 'Training')`,
      )
      .run(at(dateKey, 570), at(dateKey, 630))

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-TIMEOFF1/approve', {
        method: 'POST',
        cookie,
      }),
      409,
      'BOOKING_CONFLICT',
    )

    const pastStart = unixSeconds() - 3600
    insertAppointment(db, {
      id: 'apt_past',
      reference: 'SLO-PAST0001',
      startAt: pastStart,
      endAt: pastStart + 3600,
      status: 'pending',
    })
    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-PAST0001/approve', {
        method: 'POST',
        cookie,
      }),
      409,
      'BOOKING_CONFLICT',
    )
  })

  it('only lets the assigned staff member act on a request', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_ben',
      reference: 'SLO-BENTASK1',
      staffUserId: 'usr_ben',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'pending',
    })

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-BENTASK1/approve', {
        method: 'POST',
        cookie,
      }),
      404,
      'APPOINTMENT_NOT_FOUND',
    )
    expect(appointmentRow(db, 'SLO-BENTASK1')?.status).toBe('pending')
  })
})

describe('staff rejection and cancellation', () => {
  it('rejects a pending request with a reason, invalidates its token and audits it', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_reject',
      reference: 'SLO-REJECT01',
      customerUserId: null,
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertGuestToken(db, 'apt_reject')

    const response = await request(
      db,
      '/api/staff/appointments/SLO-REJECT01/reject',
      { method: 'POST', cookie, body: { reason: '  Fully booked  ' } },
    )
    expect(response.status).toBe(200)
    const data = await bodyData<Record<string, unknown>>(response)
    expect(data).toMatchObject({
      status: 'rejected',
      resolutionNote: 'Fully booked',
    })

    expect(appointmentRow(db, 'SLO-REJECT01')?.status).toBe('rejected')
    expect(tokenRow(db, 'apt_reject')?.invalidated_at).not.toBeNull()
    expect(auditRows(db)[0]).toMatchObject({
      action: 'appointment.rejected',
      entity_id: 'SLO-REJECT01',
    })

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-REJECT01/reject', {
        method: 'POST',
        cookie,
      }),
      409,
      'BOOKING_CONFLICT',
    )
  })

  it('cancels only a confirmed appointment for staff', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_pending',
      reference: 'SLO-CANPEND1',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-CANPEND1/cancel', {
        method: 'POST',
        cookie,
      }),
      409,
      'BOOKING_CONFLICT',
    )

    insertAppointment(db, {
      id: 'apt_confirmed',
      reference: 'SLO-CANCONF1',
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
      status: 'confirmed',
    })
    const response = await request(
      db,
      '/api/staff/appointments/SLO-CANCONF1/cancel',
      { method: 'POST', cookie, body: { reason: 'Staff emergency' } },
    )
    expect(response.status).toBe(200)
    const data = await bodyData<Record<string, unknown>>(response)
    expect(data).toMatchObject({
      status: 'cancelled',
      resolutionNote: 'Staff emergency',
    })

    const row = appointmentRow(db, 'SLO-CANCONF1')
    expect(row).toMatchObject({
      status: 'cancelled',
      cancelled_by_user_id: 'usr_ana',
      resolution_note: 'Staff emergency',
    })
    expect(row?.cancelled_at).not.toBeNull()
    expect(auditRows(db)[0]).toMatchObject({
      action: 'appointment.cancelled',
      entity_id: 'SLO-CANCONF1',
    })
  })
})

describe('staff rescheduling', () => {
  it('moves a pending request within the staff member’s schedule', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_move',
      reference: 'SLO-MOVE0001',
      customerUserId: null,
      guestName: 'Jamie Guest',
      guestEmail: 'jamie@example.com',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertGuestToken(db, 'apt_move')

    const response = await request(db, '/api/staff/appointments/SLO-MOVE0001', {
      method: 'PATCH',
      cookie,
      body: { startAt: at(dateKey, 720) },
    })
    expect(response.status).toBe(200)
    const data = await bodyData<Record<string, unknown>>(response)
    expect(data).toMatchObject({
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
      status: 'pending',
    })

    const row = appointmentRow(db, 'SLO-MOVE0001')
    expect(row).toMatchObject({
      start_at: at(dateKey, 720),
      end_at: at(dateKey, 780),
      status: 'pending',
    })
    expect(auditRows(db)[0]).toMatchObject({
      action: 'appointment.rescheduled',
      entity_id: 'SLO-MOVE0001',
    })
    // The appointment is still pending, so its guest cancellation link stays live.
    expect(tokenRow(db, 'apt_move')).toMatchObject({
      invalidated_at: null,
      used_at: null,
    })
  })

  it('rejects past, outside-window and non-minute times with 422', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)
    const today = todayDateKey(MANILA)

    insertAppointment(db, {
      id: 'apt_move',
      reference: 'SLO-MOVE0002',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-MOVE0002', {
        method: 'PATCH',
        cookie,
        body: { startAt: unixSeconds() - 60 },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-MOVE0002', {
        method: 'PATCH',
        cookie,
        body: { startAt: at(addDaysToDateKey(today, 61), 600) },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-MOVE0002', {
        method: 'PATCH',
        cookie,
        body: { startAt: at(dateKey, 600) + 30 },
      }),
      422,
      'VALIDATION_ERROR',
    )
  })

  it('rejects a move onto a confirmed appointment with 409', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_move',
      reference: 'SLO-MOVE0003',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertAppointment(db, {
      id: 'apt_block',
      reference: 'SLO-BLOCK001',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'confirmed',
    })

    await expectApiError(
      await request(db, '/api/staff/appointments/SLO-MOVE0003', {
        method: 'PATCH',
        cookie,
        body: { startAt: at(dateKey, 690) },
      }),
      409,
      'BOOKING_CONFLICT',
    )
    expect(appointmentRow(db, 'SLO-MOVE0003')?.start_at).toBe(at(dateKey, 600))
  })
})

describe('admin appointment management', () => {
  it('lists, filters and returns any appointment detail', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_ana',
      reference: 'SLO-ADMIN001',
      staffUserId: 'usr_ana',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertAppointment(db, {
      id: 'apt_ben',
      reference: 'SLO-ADMIN002',
      staffUserId: 'usr_ben',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'confirmed',
    })

    const allResponse = await request(db, '/api/admin/appointments', { cookie })
    expect(allResponse.status).toBe(200)
    const all = await bodyData<Array<{ publicReference: string }>>(allResponse)
    expect(all.map((entry) => entry.publicReference)).toEqual([
      'SLO-ADMIN001',
      'SLO-ADMIN002',
    ])

    const byStaff = await bodyData<Array<{ publicReference: string }>>(
      await request(db, '/api/admin/appointments?staffId=usr_ben', { cookie }),
    )
    expect(byStaff.map((entry) => entry.publicReference)).toEqual([
      'SLO-ADMIN002',
    ])

    const byStatus = await bodyData<Array<{ publicReference: string }>>(
      await request(db, '/api/admin/appointments?status=pending', { cookie }),
    )
    expect(byStatus.map((entry) => entry.publicReference)).toEqual([
      'SLO-ADMIN001',
    ])

    const byDate = await bodyData<Array<{ publicReference: string }>>(
      await request(db, `/api/admin/appointments?date=${dateKey}`, { cookie }),
    )
    expect(byDate).toHaveLength(2)

    const bySearch = await bodyData<Array<{ publicReference: string }>>(
      await request(db, '/api/admin/appointments?q=admin002', { cookie }),
    )
    expect(bySearch.map((entry) => entry.publicReference)).toEqual([
      'SLO-ADMIN002',
    ])

    const detail = await bodyData<Record<string, unknown>>(
      await request(db, '/api/admin/appointments/SLO-ADMIN002', { cookie }),
    )
    expect(detail).toMatchObject({
      publicReference: 'SLO-ADMIN002',
      assignedStaff: { id: 'usr_ben', name: 'Ben Cruz' },
    })
  })

  it('returns only active staff for reassignment', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    db.raw
      .prepare(
        `INSERT INTO users (
           id, name, email, password_hash, role, is_active,
           must_change_password, created_at, updated_at
         ) VALUES ('usr_inactive', 'Inactive Staff', 'inactive@slotly.studio',
                   'hash', 'staff', 0, 0, unixepoch(), unixepoch())`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO staff_profiles (user_id) VALUES ('usr_inactive')`,
      )
      .run()

    const data = await bodyData<Array<{ id: string; email: string }>>(
      await request(db, '/api/admin/staff', { cookie }),
    )
    expect(data.map((entry) => entry.id)).toEqual(['usr_ana', 'usr_ben', 'usr_ciel'])
    expect(data.some((entry) => entry.id === 'usr_inactive')).toBe(false)
  })

  it('reassigns a pending appointment to another active staff member', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const dateKey = nextDateKey(SHARED_WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_reassign',
      reference: 'SLO-REASS001',
      staffUserId: 'usr_ana',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })

    const response = await request(
      db,
      '/api/admin/appointments/SLO-REASS001/reassign',
      {
        method: 'POST',
        cookie,
        body: { staffId: 'usr_ben', startAt: at(dateKey, 660) },
      },
    )
    expect(response.status).toBe(200)
    const data = await bodyData<Record<string, unknown>>(response)
    expect(data).toMatchObject({
      status: 'pending',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      assignedStaff: {
        id: 'usr_ben',
        name: 'Ben Cruz',
        email: 'ben@slotly.studio',
      },
    })

    const row = appointmentRow(db, 'SLO-REASS001')
    expect(row).toMatchObject({
      assigned_staff_user_id: 'usr_ben',
      start_at: at(dateKey, 660),
      end_at: at(dateKey, 720),
      status: 'pending',
    })
    expect(auditRows(db)[0]).toMatchObject({
      actor_user_id: 'usr_admin',
      action: 'appointment.reassigned',
      entity_id: 'SLO-REASS001',
    })
    expect(JSON.parse(auditRows(db)[0].metadata_json)).toMatchObject({
      fromStaffUserId: 'usr_ana',
      toStaffUserId: 'usr_ben',
    })
  })

  it('validates reassignment targets, schedules and status', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const dateKey = nextDateKey(SHARED_WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_reassign',
      reference: 'SLO-REASS002',
      staffUserId: 'usr_ana',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })

    await expectApiError(
      await request(db, '/api/admin/appointments/SLO-REASS002/reassign', {
        method: 'POST',
        cookie,
        body: { staffId: 'usr_ana' },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/admin/appointments/SLO-REASS002/reassign', {
        method: 'POST',
        cookie,
        body: { staffId: 'usr_missing' },
      }),
      404,
      'STAFF_NOT_FOUND',
    )

    await expectApiError(
      await request(db, '/api/admin/appointments/SLO-REASS002/reassign', {
        method: 'POST',
        cookie,
        body: { staffId: 'usr_ben', startAt: unixSeconds() - 60 },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/admin/appointments/SLO-REASS002/reassign', {
        method: 'POST',
        cookie,
        body: {
          staffId: 'usr_ben',
          startAt: at(addDaysToDateKey(todayDateKey(MANILA), 61), 660),
        },
      }),
      422,
      'VALIDATION_ERROR',
    )

    insertAppointment(db, {
      id: 'apt_ben_conflict',
      reference: 'SLO-BENBLOCK',
      staffUserId: 'usr_ben',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'confirmed',
    })
    await expectApiError(
      await request(db, '/api/admin/appointments/SLO-REASS002/reassign', {
        method: 'POST',
        cookie,
        body: { staffId: 'usr_ben', startAt: at(dateKey, 660) },
      }),
      409,
      'BOOKING_CONFLICT',
    )
    expect(appointmentRow(db, 'SLO-REASS002')?.assigned_staff_user_id).toBe(
      'usr_ana',
    )
  })

  it('approves, reschedules and cancels any appointment with an audit trail', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_admin_approve',
      reference: 'SLO-ADAPP001',
      staffUserId: 'usr_ben',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'pending',
    })

    const approved = await bodyData<Record<string, unknown>>(
      await request(db, '/api/admin/appointments/SLO-ADAPP001/approve', {
        method: 'POST',
        cookie,
      }),
    )
    expect(approved).toMatchObject({ status: 'confirmed' })

    const moved = await bodyData<Record<string, unknown>>(
      await request(db, '/api/admin/appointments/SLO-ADAPP001', {
        method: 'PATCH',
        cookie,
        body: { startAt: at(dateKey, 780) },
      }),
    )
    expect(moved).toMatchObject({
      startAt: at(dateKey, 780),
      endAt: at(dateKey, 840),
      status: 'confirmed',
    })

    const cancelled = await bodyData<Record<string, unknown>>(
      await request(db, '/api/admin/appointments/SLO-ADAPP001/cancel', {
        method: 'POST',
        cookie,
        body: {},
      }),
    )
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      resolutionNote: 'Cancelled by the team',
    })

    const actions = auditRows(db).map((row) => row.action)
    expect(actions).toEqual([
      'appointment.approved',
      'appointment.rescheduled',
      'appointment.cancelled',
    ])
  })

  it('cancels a pending appointment as admin where staff cannot', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const dateKey = nextDateKey(WEEKDAYS)

    insertAppointment(db, {
      id: 'apt_admin_cancel',
      reference: 'SLO-ADCAN001',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })

    const response = await request(
      db,
      '/api/admin/appointments/SLO-ADCAN001/cancel',
      { method: 'POST', cookie },
    )
    expect(response.status).toBe(200)
    expect(appointmentRow(db, 'SLO-ADCAN001')?.status).toBe('cancelled')
  })

  it('keeps staff and admin areas role-gated', async () => {
    const customer = await login(db, 'maria@example.com')
    const staff = await login(db, 'ana@slotly.studio')

    await expectApiError(
      await request(db, '/api/staff/dashboard', { cookie: customer }),
      403,
      'FORBIDDEN',
    )
    await expectApiError(
      await request(db, '/api/admin/appointments', { cookie: staff }),
      403,
      'FORBIDDEN',
    )
  })
})

describe('appointment transition concurrency guards', () => {
  it('refuses a reschedule when the loaded start or end time is stale', async () => {
    const dateKey = nextDateKey(WEEKDAYS)
    const startAt = at(dateKey, 600)
    const endAt = at(dateKey, 660)

    insertAppointment(db, {
      id: 'apt_stale',
      reference: 'SLO-STALE001',
      startAt,
      endAt,
      status: 'confirmed',
    })

    const repository = new AppointmentsRepository(db.d1)
    const slot = {
      staffUserId: 'usr_ana',
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
      weekday: weekdayOfDateKey(dateKey),
      startMinute: 720,
      endMinute: 780,
      now: unixSeconds(),
      excludeAppointmentId: 'apt_stale',
    }

    const stale = await repository.reschedule({
      ...slot,
      currentStartAt: startAt + 60,
      currentEndAt: endAt + 60,
    })
    expect(stale).toBe(false)
    expect(appointmentRow(db, 'SLO-STALE001')?.start_at).toBe(startAt)

    const changed = await repository.reschedule({
      ...slot,
      currentStartAt: startAt,
      currentEndAt: endAt,
    })
    expect(changed).toBe(true)
    expect(appointmentRow(db, 'SLO-STALE001')).toMatchObject({
      start_at: slot.startAt,
      end_at: slot.endAt,
      status: 'confirmed',
    })
  })
})
