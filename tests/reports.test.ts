import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/app'
import { resetRateLimits } from '../worker/auth/rate-limit'
import {
  addDaysToDateKey,
  todayDateKey,
  unixSeconds,
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
): Promise<void> {
  expect(response.status).toBe(status)
  const body = (await response.json()) as { error: { code: string } }
  expect(body.error.code).toBe(code)
}

function at(dateKey: string, minutes: number): number {
  return unixSeconds(zonedTimeToUtc(dateKey, minutes, MANILA).getTime())
}

interface AppointmentFixture {
  id: string
  reference: string
  customerUserId?: string | null
  guestName?: string | null
  guestEmail?: string | null
  staffUserId?: string
  serviceId?: string
  serviceName?: string
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 60, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.reference,
      customerUserId,
      guestName,
      guestEmail,
      input.serviceId ?? 'svc_consult',
      input.serviceName ?? 'Initial consultation',
      input.staffUserId ?? 'usr_ana',
      input.startAt,
      input.endAt,
      input.status ?? 'pending',
    )
}

let db: TestDatabase
let today: string
let yesterday: string
let tomorrow: string

beforeEach(() => {
  db = createTestDatabase()
  resetRateLimits()
  today = todayDateKey(MANILA)
  yesterday = addDaysToDateKey(today, -1)
  tomorrow = addDaysToDateKey(today, 1)
})

describe('admin dashboard', () => {
  it('summarizes business-wide workload and per-staff queues', async () => {
    const cookie = await login(db, 'admin@slotly.studio')

    const fixtures: Array<{
      input: AppointmentFixture
      staffUserId: string
      status: AppointmentStatus
      endAt: number
    }> = []

    const add = (input: AppointmentFixture) => {
      insertAppointment(db, input)
      fixtures.push({
        input,
        staffUserId: input.staffUserId ?? 'usr_ana',
        status: input.status ?? 'pending',
        endAt: input.endAt,
      })
    }

    add({
      id: 'apt_dash_pending_today',
      reference: 'SLO-DASHP01',
      staffUserId: 'usr_ana',
      startAt: at(today, 540),
      endAt: at(today, 600),
    })
    add({
      id: 'apt_dash_confirmed_today',
      reference: 'SLO-DASHC01',
      staffUserId: 'usr_ana',
      startAt: at(today, 660),
      endAt: at(today, 720),
      status: 'confirmed',
    })
    add({
      id: 'apt_dash_cancelled_today',
      reference: 'SLO-DASHX01',
      staffUserId: 'usr_ben',
      startAt: at(today, 780),
      endAt: at(today, 840),
      status: 'cancelled',
    })
    add({
      id: 'apt_dash_pending_tomorrow',
      reference: 'SLO-DASHP02',
      staffUserId: 'usr_ben',
      startAt: at(tomorrow, 600),
      endAt: at(tomorrow, 660),
    })
    add({
      id: 'apt_dash_confirmed_tomorrow',
      reference: 'SLO-DASHC02',
      staffUserId: 'usr_ana',
      startAt: at(tomorrow, 660),
      endAt: at(tomorrow, 720),
      status: 'confirmed',
    })
    add({
      id: 'apt_dash_confirmed_past',
      reference: 'SLO-DASHC03',
      staffUserId: 'usr_ana',
      startAt: at(yesterday, 600),
      endAt: at(yesterday, 660),
      status: 'confirmed',
    })

    const response = await request(db, '/api/admin/dashboard', { cookie })
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      data: {
        asOf: number
        dateKey: string
        timezone: string
        totals: Record<AppointmentStatus, number>
        today: Record<AppointmentStatus, number>
        upcoming: { pending: number; confirmed: number }
        staff: Array<{
          id: string
          name: string
          pending: number
          confirmedUpcoming: number
        }>
      }
    }

    expect(body.data.dateKey).toBe(today)
    expect(body.data.timezone).toBe(MANILA)
    expect(body.data.totals).toEqual({
      pending: 2,
      confirmed: 3,
      rejected: 0,
      cancelled: 1,
    })
    expect(body.data.today).toEqual({
      pending: 1,
      confirmed: 1,
      rejected: 0,
      cancelled: 1,
    })

    const expectedUpcoming = (status: AppointmentStatus, staffId?: string) =>
      fixtures.filter(
        (fixture) =>
          fixture.status === status &&
          fixture.endAt > body.data.asOf &&
          (staffId === undefined || fixture.staffUserId === staffId),
      ).length
    const expectedPending = (staffId: string) =>
      fixtures.filter(
        (fixture) =>
          fixture.status === 'pending' && fixture.staffUserId === staffId,
      ).length

    expect(body.data.upcoming).toEqual({
      pending: expectedUpcoming('pending'),
      confirmed: expectedUpcoming('confirmed'),
    })

    const ana = body.data.staff.find((member) => member.id === 'usr_ana')
    const ben = body.data.staff.find((member) => member.id === 'usr_ben')
    expect(ana).toMatchObject({
      name: 'Ana Reyes',
      pending: expectedPending('usr_ana'),
    })
    expect(ana?.confirmedUpcoming).toBe(
      expectedUpcoming('confirmed', 'usr_ana'),
    )
    expect(ben).toMatchObject({
      name: 'Ben Cruz',
      pending: 1,
      confirmedUpcoming: 0,
    })
  })

  it('is admin-only', async () => {
    await expectApiError(
      await request(db, '/api/admin/dashboard'),
      401,
      'UNAUTHENTICATED',
    )
    await expectApiError(
      await request(db, '/api/admin/dashboard', {
        cookie: await login(db, 'maria@example.com'),
      }),
      403,
      'FORBIDDEN',
    )
    await expectApiError(
      await request(db, '/api/admin/dashboard', {
        cookie: await login(db, 'ana@slotly.studio'),
      }),
      403,
      'FORBIDDEN',
    )
  })
})

describe('admin report summary', () => {
  beforeEach(() => {
    insertAppointment(db, {
      id: 'apt_rep_pending',
      reference: 'SLO-REPP01',
      staffUserId: 'usr_ana',
      startAt: at(today, 540),
      endAt: at(today, 600),
    })
    insertAppointment(db, {
      id: 'apt_rep_confirmed',
      reference: 'SLO-REPC01',
      staffUserId: 'usr_ana',
      startAt: at(tomorrow, 600),
      endAt: at(tomorrow, 660),
      status: 'confirmed',
    })
    insertAppointment(db, {
      id: 'apt_rep_cancelled',
      reference: 'SLO-REPX01',
      staffUserId: 'usr_ben',
      serviceId: 'svc_standard',
      serviceName: 'Standard appointment',
      startAt: at(yesterday, 660),
      endAt: at(yesterday, 720),
      status: 'cancelled',
    })
    insertAppointment(db, {
      id: 'apt_rep_outside',
      reference: 'SLO-REPZ01',
      staffUserId: 'usr_ana',
      startAt: at(addDaysToDateKey(today, 10), 600),
      endAt: at(addDaysToDateKey(today, 10), 660),
      status: 'rejected',
    })
  })

  it('counts the inclusive range and breaks down by service and staff', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const response = await request(
      db,
      `/api/admin/reports/summary?from=${yesterday}&to=${tomorrow}`,
      { cookie },
    )
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      data: {
        range: { from: string; to: string; timezone: string }
        filters: {
          serviceId: string | null
          staffId: string | null
          status: AppointmentStatus | null
        }
        totals: Record<AppointmentStatus | 'appointments', number>
        byService: Array<{
          serviceId: string
          serviceName: string
          total: number
          counts: Record<AppointmentStatus, number>
        }>
        byStaff: Array<{
          staffId: string
          name: string
          total: number
          counts: Record<AppointmentStatus, number>
        }>
      }
    }

    expect(body.data.range).toEqual({
      from: yesterday,
      to: tomorrow,
      timezone: MANILA,
    })
    expect(body.data.filters).toEqual({
      serviceId: null,
      staffId: null,
      status: null,
    })
    expect(body.data.totals).toEqual({
      appointments: 3,
      pending: 1,
      confirmed: 1,
      rejected: 0,
      cancelled: 1,
    })

    const consult = body.data.byService.find(
      (service) => service.serviceId === 'svc_consult',
    )
    expect(consult).toMatchObject({
      serviceName: 'Initial consultation',
      total: 2,
      counts: { pending: 1, confirmed: 1, rejected: 0, cancelled: 0 },
    })
    const standard = body.data.byService.find(
      (service) => service.serviceId === 'svc_standard',
    )
    expect(standard).toMatchObject({
      total: 1,
      counts: { pending: 0, confirmed: 0, rejected: 0, cancelled: 1 },
    })

    const ana = body.data.byStaff.find((member) => member.staffId === 'usr_ana')
    const ben = body.data.byStaff.find((member) => member.staffId === 'usr_ben')
    expect(ana).toMatchObject({ name: 'Ana Reyes', total: 2 })
    expect(ben).toMatchObject({ name: 'Ben Cruz', total: 1 })
  })

  it('applies status, service, staff and date filters together', async () => {
    const cookie = await login(db, 'admin@slotly.studio')

    const confirmed = await request(
      db,
      `/api/admin/reports/summary?from=${yesterday}&to=${tomorrow}&status=confirmed`,
      { cookie },
    )
    const confirmedBody = (await confirmed.json()) as {
      data: { totals: Record<string, number>; byService: unknown[] }
    }
    expect(confirmedBody.data.totals.appointments).toBe(1)
    expect(confirmedBody.data.totals.confirmed).toBe(1)

    const standard = await request(
      db,
      `/api/admin/reports/summary?serviceId=svc_standard`,
      { cookie },
    )
    const standardBody = (await standard.json()) as {
      data: { totals: Record<string, number>; filters: { serviceId: string } }
    }
    expect(standardBody.data.filters.serviceId).toBe('svc_standard')
    expect(standardBody.data.totals.appointments).toBe(1)
    expect(standardBody.data.totals.cancelled).toBe(1)

    const ben = await request(db, '/api/admin/reports/summary?staffId=usr_ben', {
      cookie,
    })
    const benBody = (await ben.json()) as {
      data: { totals: Record<string, number>; byStaff: Array<{ staffId: string }> }
    }
    expect(benBody.data.totals.appointments).toBe(1)
    expect(benBody.data.byStaff).toHaveLength(1)
    expect(benBody.data.byStaff[0].staffId).toBe('usr_ben')

    const justToday = await request(
      db,
      `/api/admin/reports/summary?from=${today}&to=${today}`,
      { cookie },
    )
    const justTodayBody = (await justToday.json()) as {
      data: { totals: Record<string, number> }
    }
    expect(justTodayBody.data.totals.appointments).toBe(1)
    expect(justTodayBody.data.totals.pending).toBe(1)
  })

  it('returns an empty summary for a range with no appointments', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const future = addDaysToDateKey(today, 40)
    const response = await request(
      db,
      `/api/admin/reports/summary?from=${future}&to=${future}`,
      { cookie },
    )
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      data: {
        totals: Record<AppointmentStatus | 'appointments', number>
        byService: unknown[]
        byStaff: unknown[]
      }
    }
    expect(body.data.totals).toEqual({
      appointments: 0,
      pending: 0,
      confirmed: 0,
      rejected: 0,
      cancelled: 0,
    })
    expect(body.data.byService).toEqual([])
    expect(body.data.byStaff).toEqual([])
  })

  it('rejects invalid filters', async () => {
    const cookie = await login(db, 'admin@slotly.studio')

    await expectApiError(
      await request(db, '/api/admin/reports/summary?from=2026-02-30', {
        cookie,
      }),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(
        db,
        `/api/admin/reports/summary?from=${tomorrow}&to=${yesterday}`,
        { cookie },
      ),
      422,
      'VALIDATION_ERROR',
    )
    await expectApiError(
      await request(db, '/api/admin/reports/summary?status=expired', { cookie }),
      422,
      'VALIDATION_ERROR',
    )
  })

  it('is admin-only', async () => {
    await expectApiError(
      await request(db, '/api/admin/reports/summary', {
        cookie: await login(db, 'ana@slotly.studio'),
      }),
      403,
      'FORBIDDEN',
    )
    await expectApiError(
      await request(db, '/api/admin/reports/export.csv', {
        cookie: await login(db, 'maria@example.com'),
      }),
      403,
      'FORBIDDEN',
    )
  })
})

describe('admin CSV export', () => {
  beforeEach(() => {
    insertAppointment(db, {
      id: 'apt_csv_customer',
      reference: 'SLO-CSVC01',
      staffUserId: 'usr_ana',
      startAt: at(today, 540),
      endAt: at(today, 600),
      status: 'confirmed',
    })
    insertAppointment(db, {
      id: 'apt_csv_formula',
      reference: 'SLO-CSVF01',
      customerUserId: null,
      guestName: '=SUM(A1:A2)',
      guestEmail: 'formula@example.com',
      staffUserId: 'usr_ben',
      serviceId: 'svc_standard',
      serviceName: 'Standard appointment',
      startAt: at(today, 660),
      endAt: at(today, 720),
    })
    insertAppointment(db, {
      id: 'apt_csv_quoted',
      reference: 'SLO-CSVQ01',
      customerUserId: null,
      guestName: 'Smith, "Jamie"',
      guestEmail: 'jamie@example.com',
      staffUserId: 'usr_ben',
      serviceId: 'svc_standard',
      serviceName: 'Standard appointment',
      startAt: at(today, 780),
      endAt: at(today, 840),
      status: 'cancelled',
    })
  })

  it('exports filtered rows with quoted, formula-safe cells', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const response = await request(
      db,
      `/api/admin/reports/export.csv?from=${today}&to=${today}`,
      { cookie },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="slotly-appointments-\d{4}-\d{2}-\d{2}\.csv"$/,
    )
    expect(response.headers.get('x-report-rows')).toBe('3')
    expect(response.headers.get('x-report-truncated')).toBe('false')

    const csv = await response.text()
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      'Reference,Date,Start,End,Duration minutes,Service,Staff,Status,Booking type,Customer name,Customer email,Created',
    )
    expect(csv.endsWith('\r\n')).toBe(true)

    expect(csv).toContain(
      `SLO-CSVC01,${today},09:00,10:00,60,Initial consultation,Ana Reyes,confirmed,customer,Maria Santos,maria@example.com,`,
    )
    // Formula-like cells are prefixed with an apostrophe.
    expect(csv).toContain('SLO-CSVF01')
    expect(csv).toContain(",'=SUM(A1:A2),formula@example.com,")
    // Commas and quotes are RFC 4180 escaped.
    expect(csv).toContain('"Smith, ""Jamie"""')
    expect(csv).toContain(
      `SLO-CSVQ01,${today},13:00,14:00,60,Standard appointment,Ben Cruz,cancelled,guest`,
    )
  })

  it('uses the same filters as the report summary', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const response = await request(
      db,
      '/api/admin/reports/export.csv?serviceId=svc_standard',
      { cookie },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-report-rows')).toBe('2')

    const csv = await response.text()
    expect(csv).not.toContain('SLO-CSVC01')
    expect(csv).toContain('SLO-CSVF01')
    expect(csv).toContain('SLO-CSVQ01')
  })

  it('returns a header-only file for an empty range', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    const future = addDaysToDateKey(today, 40)
    const response = await request(
      db,
      `/api/admin/reports/export.csv?from=${future}&to=${future}`,
      { cookie },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-report-rows')).toBe('0')
    expect(response.headers.get('x-report-truncated')).toBe('false')
    expect(await response.text()).toBe(
      'Reference,Date,Start,End,Duration minutes,Service,Staff,Status,Booking type,Customer name,Customer email,Created\r\n',
    )
  })

  it('rejects invalid filters before producing a file', async () => {
    const cookie = await login(db, 'admin@slotly.studio')
    await expectApiError(
      await request(db, '/api/admin/reports/export.csv?from=not-a-date', {
        cookie,
      }),
      422,
      'VALIDATION_ERROR',
    )
  })
})
