import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/app'
import { resetRateLimits } from '../worker/auth/rate-limit'
import {
  addDaysToDateKey,
  minutesOfDay,
  todayDateKey,
  unixSeconds,
  weekdayOfDateKey,
  zonedTimeToUtc,
} from '../worker/lib/time'
import { createTestDatabase, type TestDatabase } from './helpers/test-d1'

const ORIGIN = 'http://localhost'
const MANILA = 'Asia/Manila'
const DEMO_PASSWORD = 'slotly-demo'

interface RequestOptions {
  method?: string
  body?: unknown
  origin?: string | null
  cookie?: string
  url?: string
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
    options.url ?? `${ORIGIN}${path}`,
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

/** Next business-local date whose weekday is one of `weekdays`. */
function nextDateKey(weekdays: number[]): string {
  const today = todayDateKey(MANILA)
  for (let offset = 1; offset <= 14; offset += 1) {
    const dateKey = addDaysToDateKey(today, offset)
    if (weekdays.includes(weekdayOfDateKey(dateKey))) return dateKey
  }
  throw new Error('No matching weekday found within two weeks.')
}

function addAppointment(
  db: TestDatabase,
  input: {
    id: string
    publicReference: string
    staffUserId: string
    serviceId?: string
    startAt: number
    endAt: number
    status?: 'pending' | 'confirmed' | 'rejected' | 'cancelled'
  },
): void {
  db.raw
    .prepare(
      `INSERT INTO appointments (
         id, public_reference, customer_user_id, service_id,
         service_name_snapshot, duration_minutes_snapshot,
         assigned_staff_user_id, start_at, end_at, status
       ) VALUES (?, ?, 'usr_maria', ?, 'Initial consultation', 60, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.publicReference,
      input.serviceId ?? 'svc_consult',
      input.staffUserId,
      input.startAt,
      input.endAt,
      input.status ?? 'confirmed',
    )
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  resetRateLimits()
})

describe('GET /api/public/availability', () => {
  it('returns 15-minute Unix-second slots without staff ids', async () => {
    const dateKey = nextDateKey([1, 2, 3, 4, 5])

    const response = await request(
      db,
      `/api/public/availability?serviceId=svc_consult&date=${dateKey}`,
      { origin: null },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        dateKey: string
        state: string
        slots: Array<{ startAt: number; endAt: number; staffId?: string }>
      }
    }

    expect(body.data.dateKey).toBe(dateKey)
    expect(body.data.state).toBe('open')
    expect(body.data.slots.length).toBeGreaterThan(0)

    for (const slot of body.data.slots) {
      expect(Number.isInteger(slot.startAt)).toBe(true)
      expect(Number.isInteger(slot.endAt)).toBe(true)
      expect(slot.endAt - slot.startAt).toBe(60 * 60)
      expect(minutesOfDay(new Date(slot.startAt * 1000), MANILA) % 15).toBe(0)
      expect(slot).not.toHaveProperty('staffId')
    }
  })

  it('reports past, closed and outside-window days truthfully', async () => {
    const today = todayDateKey(MANILA)

    const past = await request(
      db,
      `/api/public/availability?serviceId=svc_consult&date=${addDaysToDateKey(today, -1)}`,
      { origin: null },
    )
    expect(past.status).toBe(200)
    const pastBody = (await past.json()) as { data: { state: string } }
    expect(pastBody.data.state).toBe('past')

    const sunday = nextDateKey([0])
    const closed = await request(
      db,
      `/api/public/availability?serviceId=svc_consult&date=${sunday}`,
      { origin: null },
    )
    expect(closed.status).toBe(200)
    const closedBody = (await closed.json()) as { data: { state: string } }
    expect(closedBody.data.state).toBe('closed')

    const beyond = await request(
      db,
      `/api/public/availability?serviceId=svc_consult&date=${addDaysToDateKey(today, 61)}`,
      { origin: null },
    )
    expect(beyond.status).toBe(200)
    const beyondBody = (await beyond.json()) as { data: { state: string } }
    expect(beyondBody.data.state).toBe('outside-booking-window')
  })

  it('omits confirmed bookings from availability and ignores pending requests', async () => {
    const dateKey = nextDateKey([1, 2, 3, 4, 5])
    const appointmentStart = at(dateKey, 540)
    const appointmentEnd = at(dateKey, 600)

    addAppointment(db, {
      id: 'apt_confirmed',
      publicReference: 'SLO-CONF01',
      staffUserId: 'usr_ana',
      startAt: appointmentStart,
      endAt: appointmentEnd,
    })
    addAppointment(db, {
      id: 'apt_pending',
      publicReference: 'SLO-PEND01',
      staffUserId: 'usr_ben',
      startAt: appointmentStart,
      endAt: appointmentEnd,
      status: 'pending',
    })

    const response = await request(
      db,
      `/api/public/availability?serviceId=svc_consult&date=${dateKey}`,
      { origin: null },
    )
    const body = (await response.json()) as {
      data: { slots: Array<{ startAt: number }> }
    }
    const starts = body.data.slots.map((slot) => slot.startAt)

    // Ana's confirmed 09:00 booking still hides 09:00, but pending requests on
    // Ben must not do the same: every slot is a start a staff member can take.
    expect(starts).not.toContain(appointmentStart)
    expect(starts).toContain(at(dateKey, 915))
  })

  it('validates the service and date', async () => {
    await expectApiError(
      await request(db, '/api/public/availability?date=2026-11-16', {
        origin: null,
      }),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(db, '/api/public/availability?serviceId=svc_consult', {
        origin: null,
      }),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(
        db,
        '/api/public/availability?serviceId=svc_consult&date=2026-02-30',
        { origin: null },
      ),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(
        db,
        '/api/public/availability?serviceId=svc_missing&date=2026-11-16',
        { origin: null },
      ),
      404,
      'SERVICE_NOT_FOUND',
    )
    await expectApiError(
      await request(
        db,
        '/api/public/availability?serviceId=svc_group&date=2026-11-16',
        { origin: null },
      ),
      404,
      'SERVICE_NOT_FOUND',
    )
  })
})

describe('staff schedule routes', () => {
  it('requires the staff role', async () => {
    await expectApiError(
      await request(db, '/api/staff/availability'),
      401,
      'UNAUTHENTICATED',
    )

    const customer = await login(db, 'maria@example.com')
    await expectApiError(
      await request(db, '/api/staff/availability', { cookie: customer }),
      403,
      'FORBIDDEN',
    )

    const admin = await login(db, 'admin@slotly.studio')
    await expectApiError(
      await request(db, '/api/staff/availability', { cookie: admin }),
      403,
      'FORBIDDEN',
    )
  })

  it('reads and replaces the signed-in staff member’s schedule', async () => {
    const cookie = await login(db, 'ana@slotly.studio')

    const initial = await request(db, '/api/staff/availability', { cookie })
    expect(initial.status).toBe(200)
    const initialBody = (await initial.json()) as {
      data: {
        staff: { id: string; name: string }
        workingHours: unknown[]
        timeOff: unknown[]
      }
    }
    expect(initialBody.data.staff).toMatchObject({ id: 'usr_ana' })
    expect(initialBody.data.workingHours).toHaveLength(5)
    expect(initialBody.data.timeOff).toEqual([])

    const updated = await request(db, '/api/staff/availability', {
      method: 'PUT',
      cookie,
      body: {
        workingHours: [
          { weekday: 2, startMinute: 600, endMinute: 720 },
          { weekday: 4, startMinute: 780, endMinute: 1020 },
        ],
      },
    })
    expect(updated.status).toBe(200)
    const updatedBody = (await updated.json()) as {
      data: {
        workingHours: Array<{
          weekday: number
          startMinute: number
          endMinute: number
        }>
      }
    }
    expect(updatedBody.data.workingHours).toEqual([
      { id: expect.stringMatching(/^hrs_/), weekday: 2, startMinute: 600, endMinute: 720 },
      { id: expect.stringMatching(/^hrs_/), weekday: 4, startMinute: 780, endMinute: 1020 },
    ])
  })

  it('rejects overlapping or invalid working hours', async () => {
    const cookie = await login(db, 'ana@slotly.studio')

    await expectApiError(
      await request(db, '/api/staff/availability', {
        method: 'PUT',
        cookie,
        body: {
          workingHours: [
            { weekday: 1, startMinute: 540, endMinute: 720 },
            { weekday: 1, startMinute: 660, endMinute: 900 },
          ],
        },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/staff/availability', {
        method: 'PUT',
        cookie,
        body: {
          workingHours: [{ weekday: 8, startMinute: 540, endMinute: 600 }],
        },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/staff/availability', {
        method: 'PUT',
        cookie,
        body: { workingHours: 'not-an-array' },
      }),
      422,
      'VALIDATION_ERROR',
    )
  })

  it('adds and removes time off only for the signed-in staff member', async () => {
    const cookie = await login(db, 'ben@slotly.studio')
    const startAt = unixSeconds() + 30 * 24 * 60 * 60
    const endAt = startAt + 2 * 60 * 60

    const created = await request(db, '/api/staff/time-off', {
      cookie,
      body: { startAt, endAt, reason: 'Training' },
    })
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as {
      data: { id: string; startAt: number; endAt: number; reason: string }
    }
    expect(createdBody.data).toMatchObject({
      startAt,
      endAt,
      reason: 'Training',
    })

    const otherCookie = await login(db, 'ana@slotly.studio')
    await expectApiError(
      await request(db, `/api/staff/time-off/${createdBody.data.id}`, {
        method: 'DELETE',
        cookie: otherCookie,
      }),
      404,
      'TIME_OFF_NOT_FOUND',
    )

    const deleted = await request(
      db,
      `/api/staff/time-off/${createdBody.data.id}`,
      { method: 'DELETE', cookie },
    )
    expect(deleted.status).toBe(204)

    await expectApiError(
      await request(db, `/api/staff/time-off/${createdBody.data.id}`, {
        method: 'DELETE',
        cookie,
      }),
      404,
      'TIME_OFF_NOT_FOUND',
    )
  })

  it('rejects time off that has already ended or has invalid bounds', async () => {
    const cookie = await login(db, 'ana@slotly.studio')

    await expectApiError(
      await request(db, '/api/staff/time-off', {
        cookie,
        body: {
          startAt: unixSeconds() - 7200,
          endAt: unixSeconds() - 3600,
        },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/staff/time-off', {
        cookie,
        body: {
          startAt: unixSeconds() + 7200,
          endAt: unixSeconds() + 3600,
        },
      }),
      422,
      'VALIDATION_ERROR',
    )
  })

  it('returns affected bookings instead of invalidating future appointments', async () => {
    const cookie = await login(db, 'ana@slotly.studio')
    const dateKey = nextDateKey([1, 2, 3, 4, 5])
    const startAt = at(dateKey, 600)
    const endAt = at(dateKey, 660)

    addAppointment(db, {
      id: 'apt_ana_future',
      publicReference: 'SLO-AFFECTED',
      staffUserId: 'usr_ana',
      startAt,
      endAt,
    })

    const timeOff = await request(db, '/api/staff/time-off', {
      cookie,
      body: {
        startAt: at(dateKey, 630),
        endAt: at(dateKey, 690),
        reason: 'Appointment',
      },
    })
    const timeOffError = await expectApiError(
      timeOff,
      409,
      'SCHEDULE_CHANGE_CONFLICT',
    )
    expect(timeOffError.details).toEqual({
      affectedBookings: [
        {
          publicReference: 'SLO-AFFECTED',
          status: 'confirmed',
          startAt,
        },
      ],
    })

    const schedule = await request(db, '/api/staff/availability', {
      method: 'PUT',
      cookie,
      body: { workingHours: [] },
    })
    await expectApiError(schedule, 409, 'SCHEDULE_CHANGE_CONFLICT')
  })
})

describe('admin service routes', () => {
  it('requires the admin role', async () => {
    const staff = await login(db, 'ana@slotly.studio')
    await expectApiError(
      await request(db, '/api/admin/services', { cookie: staff }),
      403,
      'FORBIDDEN',
    )

    const customer = await login(db, 'maria@example.com')
    await expectApiError(
      await request(db, '/api/admin/services', { cookie: customer }),
      403,
      'FORBIDDEN',
    )
  })

  it('lists every service, including inactive ones', async () => {
    const cookie = await login(db, 'admin@slotly.studio')

    const response = await request(db, '/api/admin/services', { cookie })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: Array<{ id: string; isActive: boolean }>
    }

    expect(body.data.map((service) => service.id)).toEqual(
      expect.arrayContaining(['svc_consult', 'svc_extended', 'svc_group']),
    )
    expect(body.data.find((service) => service.id === 'svc_group')?.isActive).toBe(
      false,
    )
  })

  it('creates and updates a service', async () => {
    const cookie = await login(db, 'admin@slotly.studio')

    const created = await request(db, '/api/admin/services', {
      cookie,
      body: {
        name: '  Colour touch-up  ',
        description: 'A quick refresh.',
        durationMinutes: 30,
      },
    })
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as {
      data: { id: string; name: string; durationMinutes: number; isActive: boolean }
    }
    expect(createdBody.data).toMatchObject({
      name: 'Colour touch-up',
      durationMinutes: 30,
      isActive: true,
    })

    const updated = await request(
      db,
      `/api/admin/services/${createdBody.data.id}`,
      {
        method: 'PATCH',
        cookie,
        body: { durationMinutes: 45, isActive: false },
      },
    )
    expect(updated.status).toBe(200)
    const updatedBody = (await updated.json()) as {
      data: { durationMinutes: number; isActive: boolean }
    }
    expect(updatedBody.data).toMatchObject({
      durationMinutes: 45,
      isActive: false,
    })
  })

  it('validates service input and rejects empty patches', async () => {
    const cookie = await login(db, 'admin@slotly.studio')

    await expectApiError(
      await request(db, '/api/admin/services', {
        cookie,
        body: { name: 'A', durationMinutes: 0 },
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/admin/services/svc_consult', {
        method: 'PATCH',
        cookie,
        body: {},
      }),
      422,
      'VALIDATION_ERROR',
    )

    await expectApiError(
      await request(db, '/api/admin/services/svc_missing', {
        method: 'PATCH',
        cookie,
        body: { name: 'Renamed service' },
      }),
      404,
      'SERVICE_NOT_FOUND',
    )
  })

  it('blocks deactivation while future pending or confirmed bookings exist', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const dateKey = nextDateKey([1, 2, 3, 4, 5])
    const startAt = at(dateKey, 600)
    const endAt = at(dateKey, 660)

    addAppointment(db, {
      id: 'apt_service_future',
      publicReference: 'SLO-SVCFUT',
      staffUserId: 'usr_ana',
      serviceId: 'svc_consult',
      startAt,
      endAt,
      status: 'pending',
    })

    const response = await request(db, '/api/admin/services/svc_consult', {
      method: 'PATCH',
      cookie,
      body: { isActive: false },
    })
    const error = await expectApiError(
      response,
      409,
      'SERVICE_HAS_FUTURE_BOOKINGS',
    )
    expect(error.details).toEqual({
      affectedBookings: [
        {
          publicReference: 'SLO-SVCFUT',
          status: 'pending',
          startAt,
        },
      ],
    })

    // The service stays active because the conflicting update was rejected.
    const publicResponse = await request(db, '/api/public/services', {
      origin: null,
    })
    const publicBody = (await publicResponse.json()) as {
      data: Array<{ id: string }>
    }
    expect(publicBody.data.map((service) => service.id)).toContain('svc_consult')
  })

  it('allows deactivation once no future bookings remain', async () => {
    const cookie = await login(db, 'admin@slotly.studio')

    const created = await request(db, '/api/admin/services', {
      cookie,
      body: { name: 'Retired service', durationMinutes: 30 },
    })
    const id = ((await created.json()) as { data: { id: string } }).data.id

    const response = await request(db, `/api/admin/services/${id}`, {
      method: 'PATCH',
      cookie,
      body: { isActive: false },
    })
    expect(response.status).toBe(200)

    const publicResponse = await request(db, '/api/public/services', {
      origin: null,
    })
    const publicBody = (await publicResponse.json()) as {
      data: Array<{ id: string }>
    }
    expect(publicBody.data.map((service) => service.id)).not.toContain(id)
  })
})
