import { describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { TestDatabase } from './helpers/test-d1'

type Role = 'customer' | 'staff' | 'admin'
type AppointmentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'

interface UserFixture {
  id: string
  name: string
  email: string
  passwordHash: string
  role: Role
}

interface ServiceFixture {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  isActive: number
}

interface AppointmentFixture {
  id: string
  publicReference: string
  customerUserId: string | null
  guestName: string | null
  guestEmail: string | null
  serviceId: string
  serviceName: string
  durationMinutes: number
  assignedStaffUserId: string
  startAt: number
  endAt: number
  status: AppointmentStatus
}

function addUser(
  db: DatabaseSync,
  overrides: Partial<UserFixture> = {},
): UserFixture {
  const user: UserFixture = {
    id: 'usr_customer',
    name: 'Maria Santos',
    email: 'maria@example.com',
    passwordHash: 'pbkdf2-sha256$test$hash',
    role: 'customer',
    ...overrides,
  }

  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(user.id, user.name, user.email, user.passwordHash, user.role)

  return user
}

function addService(
  db: DatabaseSync,
  overrides: Partial<ServiceFixture> = {},
): ServiceFixture {
  const service: ServiceFixture = {
    id: 'svc_consult',
    name: 'Initial consultation',
    description: 'A first visit.',
    durationMinutes: 60,
    isActive: 1,
    ...overrides,
  }

  db.prepare(
    `INSERT INTO services (id, name, description, duration_minutes, is_active)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    service.id,
    service.name,
    service.description,
    service.durationMinutes,
    service.isActive,
  )

  return service
}

function addBookingFixtures(
  db: DatabaseSync,
): { customer: UserFixture; staff: UserFixture } {
  const customer = addUser(db)
  const staff = addUser(db, {
    id: 'usr_staff',
    name: 'Ana Reyes',
    email: 'ana@slotly.studio',
    role: 'staff',
  })
  addService(db)
  return { customer, staff }
}

function addAppointment(
  db: DatabaseSync,
  overrides: Partial<AppointmentFixture> = {},
): AppointmentFixture {
  const appointment: AppointmentFixture = {
    id: 'apt_1',
    publicReference: 'SLO-TEST01',
    customerUserId: 'usr_customer',
    guestName: null,
    guestEmail: null,
    serviceId: 'svc_consult',
    serviceName: 'Initial consultation',
    durationMinutes: 60,
    assignedStaffUserId: 'usr_staff',
    startAt: 1_800_000_000,
    endAt: 1_800_003_600,
    status: 'pending',
    ...overrides,
  }

  db.prepare(
    `INSERT INTO appointments (
       id, public_reference, customer_user_id, guest_name, guest_email,
       service_id, service_name_snapshot, duration_minutes_snapshot,
       assigned_staff_user_id, start_at, end_at, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    appointment.id,
    appointment.publicReference,
    appointment.customerUserId,
    appointment.guestName,
    appointment.guestEmail,
    appointment.serviceId,
    appointment.serviceName,
    appointment.durationMinutes,
    appointment.assignedStaffUserId,
    appointment.startAt,
    appointment.endAt,
    appointment.status,
  )

  return appointment
}

function namesOf(db: DatabaseSync, type: 'table' | 'index'): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = ? AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all(type) as Array<{ name: string }>
  return rows.map((row) => row.name)
}

describe('D1 initial schema', () => {
  it('creates every proposed table', () => {
    const db = new TestDatabase().migrate().raw

    expect(namesOf(db, 'table')).toEqual([
      'appointments',
      'audit_logs',
      'business_settings',
      'guest_cancellation_tokens',
      'notification_outbox',
      'services',
      'sessions',
      'staff_profiles',
      'staff_time_off',
      'staff_working_hours',
      'users',
    ])
  })

  it('creates the indexes required for queues, history and tokens', () => {
    const db = new TestDatabase().migrate().raw

    expect(namesOf(db, 'index')).toEqual([
      'idx_appointments_customer_start',
      'idx_appointments_service_start',
      'idx_appointments_staff_start',
      'idx_appointments_staff_status_start',
      'idx_appointments_status_start',
      'idx_audit_logs_entity',
      'idx_guest_cancellation_tokens_appointment',
      'idx_notification_outbox_status_created',
      'idx_sessions_expires',
      'idx_staff_time_off_staff_start',
      'idx_staff_working_hours_staff_weekday',
    ])
  })

  it('accepts the four appointment statuses and rejects any other status', () => {
    const db = new TestDatabase().migrate().raw
    addBookingFixtures(db)

    for (const status of ['pending', 'confirmed', 'rejected', 'cancelled'] as const) {
      addAppointment(db, {
        id: `apt_${status}`,
        publicReference: `SLO-${status.toUpperCase()}`,
        status,
      })
    }

    expect(() =>
      addAppointment(db, {
        id: 'apt_expired',
        publicReference: 'SLO-EXPIRED',
        status: 'expired' as AppointmentStatus,
      }),
    ).toThrow(/CHECK constraint failed/)
  })

  it('normalizes email and enforces role and uniqueness', () => {
    const db = new TestDatabase().migrate().raw
    addUser(db)

    expect(() =>
      addUser(db, { id: 'usr_duplicate', email: 'maria@example.com' }),
    ).toThrow(/UNIQUE constraint failed: users.email/)

    expect(() =>
      addUser(db, { id: 'usr_upper', email: 'MARIA@EXAMPLE.COM' }),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      addUser(db, {
        id: 'usr_owner',
        email: 'owner@example.com',
        role: 'owner' as Role,
      }),
    ).toThrow(/CHECK constraint failed/)
  })

  it('enforces valid service durations and working-hour bounds', () => {
    const db = new TestDatabase().migrate().raw

    expect(() => addService(db, { durationMinutes: 0 })).toThrow(
      /CHECK constraint failed/,
    )

    addUser(db, { id: 'usr_staff', email: 'ana@slotly.studio', role: 'staff' })

    expect(() =>
      db
        .prepare(
          `INSERT INTO staff_working_hours
             (id, staff_user_id, weekday, start_minute, end_minute)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('hours_bad_order', 'usr_staff', 1, 600, 600),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      db
        .prepare(
          `INSERT INTO staff_working_hours
             (id, staff_user_id, weekday, start_minute, end_minute)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('hours_bad_weekday', 'usr_staff', 7, 540, 1020),
    ).toThrow(/CHECK constraint failed/)
  })

  it('requires exactly one booking identity: registered customer or guest', () => {
    const db = new TestDatabase().migrate().raw
    addBookingFixtures(db)

    expect(() =>
      addAppointment(db, {
        id: 'apt_no_identity',
        publicReference: 'SLO-NOIDENT',
        customerUserId: null,
      }),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      addAppointment(db, {
        id: 'apt_both_identities',
        publicReference: 'SLO-BOTH',
        customerUserId: 'usr_customer',
        guestName: 'Priya Nair',
        guestEmail: 'priya@example.com',
      }),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      addAppointment(db, {
        id: 'apt_guest',
        publicReference: 'SLO-GUEST1',
        customerUserId: null,
        guestName: 'Priya Nair',
        guestEmail: 'priya@example.com',
      }),
    ).not.toThrow()
  })

  it('enforces appointment interval and duration snapshots', () => {
    const db = new TestDatabase().migrate().raw
    addBookingFixtures(db)

    expect(() =>
      addAppointment(db, {
        id: 'apt_bad_interval',
        publicReference: 'SLO-BADINT',
        startAt: 1_800_003_600,
        endAt: 1_800_003_600,
      }),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      addAppointment(db, {
        id: 'apt_bad_duration',
        publicReference: 'SLO-BADDUR',
        durationMinutes: 0,
      }),
    ).toThrow(/CHECK constraint failed/)
  })

  it('prevents duplicate public references', () => {
    const db = new TestDatabase().migrate().raw
    addBookingFixtures(db)
    addAppointment(db)

    expect(() =>
      addAppointment(db, { id: 'apt_duplicate_reference' }),
    ).toThrow(/UNIQUE constraint failed: appointments.public_reference/)
  })

  it('enforces foreign keys for services and cascade token cleanup', () => {
    const db = new TestDatabase().migrate().raw
    addBookingFixtures(db)

    expect(() =>
      addAppointment(db, {
        id: 'apt_missing_service',
        publicReference: 'SLO-NOSVC',
        serviceId: 'svc_missing',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/)

    addAppointment(db)
    db.prepare(
      `INSERT INTO guest_cancellation_tokens
         (id, appointment_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run('tok_1', 'apt_1', 'hash-only', 1_800_003_600)

    db.prepare('DELETE FROM appointments WHERE id = ?').run('apt_1')

    const remaining = db
      .prepare('SELECT COUNT(*) AS count FROM guest_cancellation_tokens')
      .get() as { count: number }
    expect(remaining.count).toBe(0)
  })

  it('stores created/updated timestamps as integer Unix seconds', () => {
    const db = new TestDatabase().migrate().raw
    const before = Math.floor(Date.now() / 1000)

    addUser(db)

    const row = db
      .prepare('SELECT created_at, updated_at FROM users WHERE id = ?')
      .get('usr_customer') as { created_at: number; updated_at: number }

    expect(Number.isInteger(row.created_at)).toBe(true)
    expect(Number.isInteger(row.updated_at)).toBe(true)
    expect(row.created_at).toBeGreaterThanOrEqual(before)
    expect(row.created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1)
  })

  it('keeps business settings as a singleton', () => {
    const db = new TestDatabase().migrate().raw
    const insert = db.prepare(
      `INSERT INTO business_settings
         (id, business_name, business_email, business_timezone, max_advance_booking_days)
       VALUES (?, ?, ?, ?, ?)`,
    )

    insert.run(1, 'Slotly Studio', 'hello@slotly.studio', 'Asia/Manila', 60)

    expect(() =>
      insert.run(2, 'Second Studio', null, 'Asia/Manila', 60),
    ).toThrow(/CHECK constraint failed/)
  })

  it('restricts outbox event and delivery statuses', () => {
    const db = new TestDatabase().migrate().raw
    addBookingFixtures(db)
    addAppointment(db)

    const insert = db.prepare(
      `INSERT INTO notification_outbox
         (id, appointment_id, event_type, recipient_email, delivery_status)
       VALUES (?, ?, ?, ?, ?)`,
    )

    expect(() =>
      insert.run('out_1', 'apt_1', 'reminder', 'maria@example.com', 'pending'),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      insert.run('out_2', 'apt_1', 'booking_confirmed', 'maria@example.com', 'queued'),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      insert.run(
        'out_3',
        'apt_1',
        'booking_confirmed',
        'maria@example.com',
        'pending',
      ),
    ).not.toThrow()
  })
})
