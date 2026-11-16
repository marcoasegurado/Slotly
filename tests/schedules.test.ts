import { beforeEach, describe, expect, it } from 'vitest'
import {
  dateKeyUnixRange,
  unixSeconds,
  zonedTimeToUtc,
} from '../worker/lib/time'
import { SchedulesRepository } from '../worker/repositories/schedules'
import { ServicesRepository } from '../worker/repositories/services'
import { createTestDatabase, type TestDatabase } from './helpers/test-d1'

const MANILA = 'Asia/Manila'
const MONDAY = '2026-11-16'

function at(dateKey: string, minutes: number): number {
  return unixSeconds(zonedTimeToUtc(dateKey, minutes, MANILA).getTime())
}

function addAppointment(
  db: TestDatabase,
  input: {
    id: string
    publicReference: string
    staffUserId: string
    startAt: number
    endAt: number
    status?: 'pending' | 'confirmed' | 'rejected' | 'cancelled'
    serviceId?: string
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
})

describe('SchedulesRepository', () => {
  it('loads only active staff data for the requested weekday', async () => {
    db.raw
      .prepare('UPDATE users SET is_active = 0 WHERE id = ?')
      .run('usr_ben')
    db.raw
      .prepare(
        `INSERT INTO staff_time_off (id, staff_user_id, start_at, end_at, reason)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'tof_test',
        'usr_ana',
        at(MONDAY, 540),
        at(MONDAY, 600),
        'Training',
      )
    addAppointment(db, {
      id: 'apt_confirmed',
      publicReference: 'SLO-CONF01',
      staffUserId: 'usr_ana',
      startAt: at(MONDAY, 600),
      endAt: at(MONDAY, 660),
    })
    addAppointment(db, {
      id: 'apt_pending',
      publicReference: 'SLO-PEND01',
      staffUserId: 'usr_ana',
      startAt: at(MONDAY, 660),
      endAt: at(MONDAY, 720),
      status: 'pending',
    })

    const range = dateKeyUnixRange(MONDAY, MANILA)
    const context = await new SchedulesRepository(db.d1).loadAvailabilityDay(
      1,
      range.start,
      range.end,
    )

    expect(context.staff.map((staff) => staff.id).sort()).toEqual([
      'usr_ana',
      'usr_ciel',
    ])
    expect(context.staff.find((staff) => staff.id === 'usr_ana')).toMatchObject({
      workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      timeOff: [{ startAt: at(MONDAY, 540), endAt: at(MONDAY, 600) }],
    })
    expect(context.confirmedAppointments).toEqual([
      {
        staffUserId: 'usr_ana',
        startAt: at(MONDAY, 600),
        endAt: at(MONDAY, 660),
      },
    ])
  })

  it('replaces a full weekly schedule atomically', async () => {
    const repository = new SchedulesRepository(db.d1)

    await repository.replaceWorkingHours('usr_ana', [
      { weekday: 2, startMinute: 600, endMinute: 720 },
      { weekday: 4, startMinute: 780, endMinute: 1020 },
    ])

    expect(await repository.listWorkingHours('usr_ana')).toEqual([
      {
        id: expect.stringMatching(/^hrs_/),
        weekday: 2,
        startMinute: 600,
        endMinute: 720,
      },
      {
        id: expect.stringMatching(/^hrs_/),
        weekday: 4,
        startMinute: 780,
        endMinute: 1020,
      },
    ])
  })

  it('adds and deletes time off only for its owner', async () => {
    const repository = new SchedulesRepository(db.d1)

    const created = await repository.addTimeOff({
      staffUserId: 'usr_ana',
      startAt: at(MONDAY, 540),
      endAt: at(MONDAY, 600),
      reason: 'Appointment',
      now: at(MONDAY, 0),
    })

    expect(created).toMatchObject({
      startAt: at(MONDAY, 540),
      endAt: at(MONDAY, 600),
      reason: 'Appointment',
    })

    expect(await repository.deleteTimeOff(created.id, 'usr_ben')).toBe(false)
    expect(await repository.deleteTimeOff(created.id, 'usr_ana')).toBe(true)
    expect(await repository.listTimeOff('usr_ana')).toEqual([])
  })

  it('lists only future pending and confirmed appointments for one staff member', async () => {
    const repository = new SchedulesRepository(db.d1)

    addAppointment(db, {
      id: 'apt_future_pending',
      publicReference: 'SLO-FUTP01',
      staffUserId: 'usr_ana',
      startAt: at(MONDAY, 600),
      endAt: at(MONDAY, 660),
      status: 'pending',
    })
    addAppointment(db, {
      id: 'apt_future_cancelled',
      publicReference: 'SLO-FUTC01',
      staffUserId: 'usr_ana',
      startAt: at(MONDAY, 660),
      endAt: at(MONDAY, 720),
      status: 'cancelled',
    })
    addAppointment(db, {
      id: 'apt_other_staff',
      publicReference: 'SLO-OTHER1',
      staffUserId: 'usr_ben',
      startAt: at(MONDAY, 660),
      endAt: at(MONDAY, 720),
      status: 'confirmed',
    })

    const appointments = await repository.listFutureAppointments(
      'usr_ana',
      at(MONDAY, 0),
    )

    expect(appointments).toEqual([
      {
        publicReference: 'SLO-FUTP01',
        status: 'pending',
        startAt: at(MONDAY, 600),
        endAt: at(MONDAY, 660),
        durationMinutes: 60,
      },
    ])
  })
})

describe('ServicesRepository', () => {
  it('lists inactive services for admin while public lists stay active-only', async () => {
    const repository = new ServicesRepository(db.d1)

    expect((await repository.listAll()).map((service) => service.id)).toEqual(
      expect.arrayContaining(['svc_group', 'svc_consult', 'svc_standard']),
    )
    expect((await repository.listActive()).map((service) => service.id)).not.toContain(
      'svc_group',
    )
  })

  it('creates and updates a service without exposing inactive ones publicly', async () => {
    const repository = new ServicesRepository(db.d1)

    const created = await repository.create({
      id: 'svc_new',
      name: 'New service',
      description: null,
      durationMinutes: 30,
      isActive: true,
      now: unixSeconds(),
    })
    expect(created).toMatchObject({
      id: 'svc_new',
      name: 'New service',
      durationMinutes: 30,
      isActive: true,
    })

    const updated = await repository.update(
      'svc_new',
      { name: 'Updated service', durationMinutes: 45, isActive: false },
      unixSeconds(),
    )
    expect(updated).toMatchObject({
      name: 'Updated service',
      durationMinutes: 45,
      isActive: false,
    })
    expect(await repository.findActiveById('svc_new')).toBeNull()
  })

  it('reports future pending and confirmed bookings before deactivation', async () => {
    addAppointment(db, {
      id: 'apt_service_pending',
      publicReference: 'SLO-SVCP01',
      staffUserId: 'usr_ana',
      startAt: at(MONDAY, 600),
      endAt: at(MONDAY, 660),
      status: 'pending',
    })
    addAppointment(db, {
      id: 'apt_service_cancelled',
      publicReference: 'SLO-SVCC01',
      staffUserId: 'usr_ana',
      startAt: at(MONDAY, 660),
      endAt: at(MONDAY, 720),
      status: 'cancelled',
    })

    const bookings = await new ServicesRepository(db.d1).listFutureBookings(
      'svc_consult',
      at(MONDAY, 0),
    )

    expect(bookings).toEqual([
      {
        publicReference: 'SLO-SVCP01',
        status: 'pending',
        startAt: at(MONDAY, 600),
      },
    ])
  })
})
