import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/app'
import { resetRateLimits } from '../worker/auth/rate-limit'
import { sha256Hex } from '../worker/lib/encoding'
import {
  addDaysToDateKey,
  todayDateKey,
  unixSeconds,
  weekdayOfDateKey,
  zonedTimeToUtc,
} from '../worker/lib/time'
import { createTestDatabase, type TestDatabase } from './helpers/test-d1'

const ORIGIN = 'http://localhost'
const MANILA = 'Asia/Manila'
const DEMO_PASSWORD = 'slotly-demo'
const MAX_REFERENCE = /^SLO-[A-Z2-9]{8}$/
const RAW_TOKEN = /^[0-9a-f]{64}$/

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

interface AppointmentFixture {
  id: string
  publicReference: string
  customerUserId?: string | null
  guestName?: string | null
  guestEmail?: string | null
  staffUserId?: string
  serviceId?: string
  startAt: number
  endAt: number
  status?: 'pending' | 'confirmed' | 'rejected' | 'cancelled'
}

function insertAppointment(db: TestDatabase, input: AppointmentFixture): void {
  const customerUserId = input.customerUserId ?? null
  const guestName = customerUserId === null ? (input.guestName ?? 'Guest Person') : null
  const guestEmail =
    customerUserId === null ? (input.guestEmail ?? 'guest@example.com') : null

  db.raw
    .prepare(
      `INSERT INTO appointments (
         id, public_reference, customer_user_id, guest_name, guest_email,
         service_id, service_name_snapshot, duration_minutes_snapshot,
         assigned_staff_user_id, start_at, end_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, 'Initial consultation', 60, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.publicReference,
      customerUserId,
      guestName,
      guestEmail,
      input.serviceId ?? 'svc_consult',
      input.staffUserId ?? 'usr_ana',
      input.startAt,
      input.endAt,
      input.status ?? 'pending',
    )
}

function bookingRow(db: TestDatabase, publicReference: string) {
  return db.raw
    .prepare(
      `SELECT id, customer_user_id, guest_name, guest_email, service_id,
              service_name_snapshot, duration_minutes_snapshot,
              assigned_staff_user_id, start_at, end_at, status,
              customer_note, resolution_note, cancelled_at, cancelled_by_user_id
         FROM appointments
        WHERE public_reference = ?`,
    )
    .get(publicReference) as
    | {
        id: string
        customer_user_id: string | null
        guest_name: string | null
        guest_email: string | null
        service_id: string
        service_name_snapshot: string
        duration_minutes_snapshot: number
        assigned_staff_user_id: string
        start_at: number
        end_at: number
        status: string
        customer_note: string | null
        resolution_note: string | null
        cancelled_at: number | null
        cancelled_by_user_id: string | null
      }
    | undefined
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  resetRateLimits()
})

describe('POST /api/public/bookings', () => {
  it('creates a pending guest booking with server-assigned staff and a hashed token', async () => {
    const dateKey = nextDateKey([1, 2, 3, 4, 5])
    const startAt = at(dateKey, 600)

    const response = await request(db, '/api/public/bookings', {
      body: {
        serviceId: 'svc_consult',
        startAt,
        guestName: '  Jamie Guest  ',
        guestEmail: '  JAMIE@Example.com ',
        customerNote: '  First visit  ',
      },
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      data: {
        appointment: Record<string, unknown>
        cancellationToken: string
      }
    }

    expect(body.data.appointment).toMatchObject({
      serviceId: 'svc_consult',
      serviceName: 'Initial consultation',
      durationMinutes: 60,
      startAt,
      endAt: at(dateKey, 660),
      status: 'pending',
      guestName: 'Jamie Guest',
      guestEmail: 'jamie@example.com',
      customerNote: 'First visit',
    })
    expect(body.data.appointment.publicReference).toMatch(MAX_REFERENCE)
    expect(body.data.appointment).not.toHaveProperty('id')
    expect(body.data.appointment).not.toHaveProperty('assignedStaffUserId')
    expect(body.data.cancellationToken).toMatch(RAW_TOKEN)

    const row = bookingRow(
      db,
      body.data.appointment.publicReference as string,
    )
    expect(row).toMatchObject({
      customer_user_id: null,
      guest_name: 'Jamie Guest',
      guest_email: 'jamie@example.com',
      service_name_snapshot: 'Initial consultation',
      duration_minutes_snapshot: 60,
      status: 'pending',
      customer_note: 'First visit',
    })
    expect(row?.start_at).toBe(startAt)
    expect(row?.end_at).toBe(at(dateKey, 660))

    const staff = db.raw
      .prepare('SELECT role, is_active FROM users WHERE id = ?')
      .get(row?.assigned_staff_user_id ?? '') as
      | { role: string; is_active: number }
      | undefined
    expect(staff).toEqual({ role: 'staff', is_active: 1 })

    const token = db.raw
      .prepare(
        `SELECT appointment_id, token_hash, expires_at, used_at
           FROM guest_cancellation_tokens
          WHERE appointment_id = ?`,
      )
      .get(row?.id ?? '') as
      | {
          appointment_id: string
          token_hash: string
          expires_at: number
          used_at: number | null
        }
      | undefined
    expect(token?.token_hash).toBe(
      await sha256Hex(body.data.cancellationToken),
    )
    expect(token?.token_hash).not.toBe(body.data.cancellationToken)
    expect(token?.used_at).toBeNull()
    expect(token?.expires_at).toBeLessThanOrEqual(startAt)
    expect(token?.expires_at).toBeGreaterThan(unixSeconds())
  })

  it('links a signed-in customer booking to the session and ignores guest fields', async () => {
    const cookie = await login(db, 'maria@example.com')
    const dateKey = nextDateKey([1, 2, 3, 4, 5])
    const startAt = at(dateKey, 600)

    const response = await request(db, '/api/public/bookings', {
      cookie,
      body: {
        serviceId: 'svc_consult',
        startAt,
        guestName: 'Spoofed Name',
        guestEmail: 'spoofed@example.com',
      },
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      data: {
        appointment: {
          publicReference: string
          guestName: string | null
          guestEmail: string | null
        }
        cancellationToken: string | null
      }
    }
    expect(body.data.cancellationToken).toBeNull()
    expect(body.data.appointment).toMatchObject({
      guestName: null,
      guestEmail: null,
    })

    const row = bookingRow(db, body.data.appointment.publicReference)
    expect(row?.customer_user_id).toBe('usr_maria')
    expect(row?.guest_name).toBeNull()
    expect(row?.guest_email).toBeNull()

    const tokens = db.raw
      .prepare('SELECT COUNT(*) AS count FROM guest_cancellation_tokens')
      .get() as { count: number }
    expect(tokens.count).toBe(0)
  })

  it('rejects past starts, outside-window starts, closed days and non-slot times', async () => {
    const today = todayDateKey(MANILA)
    const weekday = nextDateKey([1, 2, 3, 4, 5])
    const sunday = nextDateKey([0])

    const guest = {
      guestName: 'Jamie Guest',
      guestEmail: 'jamie@example.com',
    }

    await expectApiError(
      await request(db, '/api/public/bookings', {
        body: { serviceId: 'svc_consult', startAt: unixSeconds() - 60, ...guest },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/public/bookings', {
        body: {
          serviceId: 'svc_consult',
          startAt: at(addDaysToDateKey(today, 61), 600),
          ...guest,
        },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/public/bookings', {
        body: { serviceId: 'svc_consult', startAt: at(sunday, 600), ...guest },
      }),
      409,
      'BOOKING_CONFLICT',
    )

    await expectApiError(
      await request(db, '/api/public/bookings', {
        body: { serviceId: 'svc_consult', startAt: at(weekday, 607), ...guest },
      }),
      409,
      'BOOKING_CONFLICT',
    )
  })

  it('validates the service and guest details', async () => {
    const dateKey = nextDateKey([1, 2, 3, 4, 5])
    const startAt = at(dateKey, 600)

    await expectApiError(
      await request(db, '/api/public/bookings', {
        body: { serviceId: 'svc_group', startAt, guestName: 'Jamie', guestEmail: 'jamie@example.com' },
      }),
      404,
      'SERVICE_NOT_FOUND',
    )
    await expectApiError(
      await request(db, '/api/public/bookings', {
        body: { serviceId: 'svc_consult', startAt },
      }),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(db, '/api/public/bookings', {
        body: {
          serviceId: 'svc_consult',
          startAt,
          guestName: 'Jamie',
          guestEmail: 'not-an-email',
        },
      }),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(db, '/api/public/bookings', { body: { startAt }, origin: null }),
      403,
      'CSRF_REJECTED',
    )
  })

  it('does not let pending requests block a slot, even for the same staff member', async () => {
    const dateKey = nextDateKey([6]) // Saturday: only Ben is scheduled.
    const startAt = at(dateKey, 600)
    const body = {
      serviceId: 'svc_consult',
      startAt,
      guestName: 'Jamie Guest',
      guestEmail: 'jamie@example.com',
    }

    expect(
      (await request(db, '/api/public/bookings', { body })).status,
    ).toBe(201)
    expect(
      (await request(db, '/api/public/bookings', { body })).status,
    ).toBe(201)

    const rows = db.raw
      .prepare(
        `SELECT assigned_staff_user_id, status FROM appointments
          WHERE start_at = ? ORDER BY id`,
      )
      .all(startAt) as Array<{
      assigned_staff_user_id: string
      status: string
    }>
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.status === 'pending')).toBe(true)
    expect(rows.every((row) => row.assigned_staff_user_id === 'usr_ben')).toBe(
      true,
    )

    const availability = await request(
      db,
      `/api/public/availability?serviceId=svc_consult&date=${dateKey}`,
      { origin: null },
    )
    const availabilityBody = (await availability.json()) as {
      data: { slots: Array<{ startAt: number }> }
    }
    expect(
      availabilityBody.data.slots.map((slot) => slot.startAt),
    ).toContain(startAt)
  })

  it('blocks a slot when confirmed bookings or time off leave no eligible staff', async () => {
    const saturday = nextDateKey([6])
    const startAt = at(saturday, 600)
    const endAt = at(saturday, 660)
    const body = {
      serviceId: 'svc_consult',
      startAt,
      guestName: 'Jamie Guest',
      guestEmail: 'jamie@example.com',
    }

    insertAppointment(db, {
      id: 'apt_conflict',
      publicReference: 'SLO-CONFLICT',
      staffUserId: 'usr_ben',
      startAt,
      endAt,
      status: 'confirmed',
    })

    await expectApiError(
      await request(db, '/api/public/bookings', { body }),
      409,
      'BOOKING_CONFLICT',
    )

    db.raw
      .prepare(
        `UPDATE appointments SET status = 'cancelled' WHERE id = 'apt_conflict'`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO staff_time_off (id, staff_user_id, start_at, end_at, reason)
         VALUES ('tof_booking', 'usr_ben', ?, ?, 'Training')`,
      )
      .run(startAt, endAt)

    await expectApiError(
      await request(db, '/api/public/bookings', { body }),
      409,
      'BOOKING_CONFLICT',
    )
  })
})

describe('POST /api/public/guest-cancellation', () => {
  async function createGuestBooking(): Promise<{
    publicReference: string
    cancellationToken: string
  }> {
    const dateKey = nextDateKey([1, 2, 3, 4, 5])
    const response = await request(db, '/api/public/bookings', {
      body: {
        serviceId: 'svc_consult',
        startAt: at(dateKey, 600),
        guestName: 'Jamie Guest',
        guestEmail: 'jamie@example.com',
      },
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      data: {
        appointment: { publicReference: string }
        cancellationToken: string
      }
    }
    return {
      publicReference: body.data.appointment.publicReference,
      cancellationToken: body.data.cancellationToken,
    }
  }

  it('cancels the linked pending guest booking once', async () => {
    const { publicReference, cancellationToken } = await createGuestBooking()

    const response = await request(db, '/api/public/guest-cancellation', {
      body: { token: cancellationToken },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { publicReference },
    })

    const row = bookingRow(db, publicReference)
    expect(row?.status).toBe('cancelled')
    expect(row?.resolution_note).toBe('Cancelled by guest')
    expect(row?.cancelled_at).toEqual(expect.any(Number))
    expect(row?.cancelled_by_user_id).toBeNull()

    const token = db.raw
      .prepare(
        `SELECT used_at FROM guest_cancellation_tokens
          WHERE appointment_id = ?`,
      )
      .get(row?.id ?? '') as { used_at: number | null } | undefined
    expect(token?.used_at).toEqual(expect.any(Number))

    await expectApiError(
      await request(db, '/api/public/guest-cancellation', {
        body: { token: cancellationToken },
      }),
      404,
      'CANCELLATION_LINK_UNAVAILABLE',
    )
  })

  it('gives the same generic response for unknown, expired, and non-pending links', async () => {
    const unknown = await request(db, '/api/public/guest-cancellation', {
      body: { token: 'a'.repeat(64) },
    })
    const unknownError = await expectApiError(
      unknown,
      404,
      'CANCELLATION_LINK_UNAVAILABLE',
    )

    const expiredBooking = await createGuestBooking()
    db.raw
      .prepare(
        `UPDATE guest_cancellation_tokens SET expires_at = ?
          WHERE appointment_id = (
            SELECT id FROM appointments WHERE public_reference = ?
          )`,
      )
      .run(unixSeconds() - 1, expiredBooking.publicReference)
    await expectApiError(
      await request(db, '/api/public/guest-cancellation', {
        body: { token: expiredBooking.cancellationToken },
      }),
      404,
      'CANCELLATION_LINK_UNAVAILABLE',
    )

    const confirmedBooking = await createGuestBooking()
    db.raw
      .prepare(
        `UPDATE appointments SET status = 'confirmed'
          WHERE public_reference = ?`,
      )
      .run(confirmedBooking.publicReference)
    const confirmed = await expectApiError(
      await request(db, '/api/public/guest-cancellation', {
        body: { token: confirmedBooking.cancellationToken },
      }),
      404,
      'CANCELLATION_LINK_UNAVAILABLE',
    )

    expect(confirmed.message).toBe(unknownError.message)
  })
})

describe('GET /api/public/guest-cancellation/:token', () => {
  async function createGuestBooking(): Promise<{
    publicReference: string
    cancellationToken: string
  }> {
    const response = await request(db, '/api/public/bookings', {
      body: {
        serviceId: 'svc_consult',
        startAt: at(nextDateKey([1, 2, 3, 4, 5]), 660),
        guestName: 'Robin Guest',
        guestEmail: 'robin@example.com',
      },
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      data: {
        appointment: { publicReference: string }
        cancellationToken: string
      }
    }
    return {
      publicReference: body.data.appointment.publicReference,
      cancellationToken: body.data.cancellationToken,
    }
  }

  it('returns a read-only summary and never mutates the booking', async () => {
    const { publicReference, cancellationToken } = await createGuestBooking()

    const response = await request(
      db,
      `/api/public/guest-cancellation/${cancellationToken}`,
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        publicReference: string
        serviceName: string
        startAt: number
        endAt: number
      }
    }
    expect(body.data.publicReference).toBe(publicReference)
    expect(body.data.serviceName).toBe('Initial consultation')
    expect(body.data.endAt).toBeGreaterThan(body.data.startAt)

    const row = bookingRow(db, publicReference)
    expect(row?.status).toBe('pending')
  })

  it('gives the same generic response for unknown and used links', async () => {
    const unknown = await expectApiError(
      await request(db, `/api/public/guest-cancellation/${'a'.repeat(64)}`),
      404,
      'CANCELLATION_LINK_UNAVAILABLE',
    )

    const { publicReference, cancellationToken } = await createGuestBooking()
    await request(db, '/api/public/guest-cancellation', {
      body: { token: cancellationToken },
    })

    const used = await expectApiError(
      await request(db, `/api/public/guest-cancellation/${cancellationToken}`),
      404,
      'CANCELLATION_LINK_UNAVAILABLE',
    )

    expect(used.message).toBe(unknown.message)
    expect(bookingRow(db, publicReference)?.status).toBe('cancelled')
  })
})

describe('customer booking routes', () => {
  it('requires a customer session', async () => {
    await expectApiError(
      await request(db, '/api/customer/bookings'),
      401,
      'UNAUTHENTICATED',
    )

    const staff = await login(db, 'ana@slotly.studio')
    await expectApiError(
      await request(db, '/api/customer/bookings', { cookie: staff }),
      403,
      'FORBIDDEN',
    )
  })

  it('lists only the signed-in customer’s bookings and splits upcoming from past', async () => {
    const cookie = await login(db, 'maria@example.com')
    const today = todayDateKey(MANILA)
    const dateKey = nextDateKey([1, 2, 3, 4, 5])
    const pastKey = addDaysToDateKey(today, -1)

    insertAppointment(db, {
      id: 'apt_pending',
      publicReference: 'SLO-AAAA1111',
      customerUserId: 'usr_maria',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertAppointment(db, {
      id: 'apt_confirmed',
      publicReference: 'SLO-BBBB2222',
      customerUserId: 'usr_maria',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'confirmed',
    })
    insertAppointment(db, {
      id: 'apt_rejected',
      publicReference: 'SLO-CCCC3333',
      customerUserId: 'usr_maria',
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
      status: 'rejected',
    })
    insertAppointment(db, {
      id: 'apt_cancelled',
      publicReference: 'SLO-DDDD4444',
      customerUserId: 'usr_maria',
      startAt: at(dateKey, 780),
      endAt: at(dateKey, 840),
      status: 'cancelled',
    })
    insertAppointment(db, {
      id: 'apt_past',
      publicReference: 'SLO-EEEE5555',
      customerUserId: 'usr_maria',
      startAt: at(pastKey, 600),
      endAt: at(pastKey, 660),
      status: 'confirmed',
    })
    insertAppointment(db, {
      id: 'apt_other',
      publicReference: 'SLO-FFFF6666',
      customerUserId: 'usr_admin',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })

    const response = await request(db, '/api/customer/bookings', { cookie })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        upcoming: Array<Record<string, unknown>>
        past: Array<Record<string, unknown>>
      }
    }

    expect(body.data.upcoming.map((booking) => booking.publicReference)).toEqual([
      'SLO-BBBB2222',
      'SLO-AAAA1111',
    ])
    expect(body.data.past.map((booking) => booking.publicReference)).toEqual([
      'SLO-DDDD4444',
      'SLO-CCCC3333',
      'SLO-EEEE5555',
    ])
    expect(body.data.upcoming[0]).not.toHaveProperty('id')
    expect(body.data.upcoming[0]).not.toHaveProperty('assignedStaffUserId')
  })

  it('reads only the signed-in customer’s booking detail', async () => {
    const cookie = await login(db, 'maria@example.com')
    const dateKey = nextDateKey([1, 2, 3, 4, 5])

    insertAppointment(db, {
      id: 'apt_own',
      publicReference: 'SLO-OWN00001',
      customerUserId: 'usr_maria',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
    })
    insertAppointment(db, {
      id: 'apt_theirs',
      publicReference: 'SLO-THEIR001',
      customerUserId: 'usr_admin',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
    })

    const own = await request(db, '/api/customer/bookings/SLO-OWN00001', {
      cookie,
    })
    expect(own.status).toBe(200)
    const ownBody = (await own.json()) as {
      data: { publicReference: string }
    }
    expect(ownBody.data.publicReference).toBe('SLO-OWN00001')

    await expectApiError(
      await request(db, '/api/customer/bookings/SLO-THEIR001', { cookie }),
      404,
      'BOOKING_NOT_FOUND',
    )
    await expectApiError(
      await request(db, '/api/customer/bookings/SLO-MISSING1', { cookie }),
      404,
      'BOOKING_NOT_FOUND',
    )
  })

  it('cancels only the customer’s own pending booking', async () => {
    const cookie = await login(db, 'maria@example.com')
    const dateKey = nextDateKey([1, 2, 3, 4, 5])

    insertAppointment(db, {
      id: 'apt_cancel_own',
      publicReference: 'SLO-CANCEL01',
      customerUserId: 'usr_maria',
      startAt: at(dateKey, 600),
      endAt: at(dateKey, 660),
      status: 'pending',
    })
    insertAppointment(db, {
      id: 'apt_cancel_confirmed',
      publicReference: 'SLO-CANCEL02',
      customerUserId: 'usr_maria',
      startAt: at(dateKey, 660),
      endAt: at(dateKey, 720),
      status: 'confirmed',
    })
    insertAppointment(db, {
      id: 'apt_cancel_theirs',
      publicReference: 'SLO-CANCEL03',
      customerUserId: 'usr_admin',
      startAt: at(dateKey, 720),
      endAt: at(dateKey, 780),
      status: 'pending',
    })

    const cancelled = await request(
      db,
      '/api/customer/bookings/slo-cancel01/cancel',
      { method: 'POST', cookie },
    )
    expect(cancelled.status).toBe(200)
    const cancelledBody = (await cancelled.json()) as {
      data: { status: string; publicReference: string }
    }
    expect(cancelledBody.data).toMatchObject({
      publicReference: 'SLO-CANCEL01',
      status: 'cancelled',
    })

    const row = bookingRow(db, 'SLO-CANCEL01')
    expect(row?.cancelled_at).toEqual(expect.any(Number))
    expect(row?.cancelled_by_user_id).toBe('usr_maria')
    expect(row?.resolution_note).toBe('Cancelled by customer')

    await expectApiError(
      await request(db, '/api/customer/bookings/SLO-CANCEL02/cancel', {
        method: 'POST',
        cookie,
      }),
      409,
      'BOOKING_CONFLICT',
    )
    await expectApiError(
      await request(db, '/api/customer/bookings/SLO-CANCEL03/cancel', {
        method: 'POST',
        cookie,
      }),
      404,
      'BOOKING_NOT_FOUND',
    )
    await expectApiError(
      await request(db, '/api/customer/bookings/SLO-CANCEL01/cancel', {
        method: 'POST',
        cookie,
      }),
      409,
      'BOOKING_CONFLICT',
    )
  })
})
