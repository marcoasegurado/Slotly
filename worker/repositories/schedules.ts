import { randomId } from '../lib/encoding'
import { unixSeconds } from '../lib/time'
import type { AppointmentStatus, StaffSchedule, TimeOff, WorkingHour } from '../types'
import type {
  AvailabilityStaff,
  ConfirmedAppointment,
} from '../services/availability'

interface StaffRow {
  id: string
  name: string
  email: string
}

interface WorkingHourRow {
  id: string
  weekday: number
  start_minute: number
  end_minute: number
}

interface StaffWorkingHourRow extends WorkingHourRow {
  staff_user_id: string
}

interface TimeOffRow {
  id: string
  start_at: number
  end_at: number
  reason: string | null
}

interface StaffTimeOffRow {
  staff_user_id: string
  start_at: number
  end_at: number
}

interface ConfirmedAppointmentRow {
  assigned_staff_user_id: string
  start_at: number
  end_at: number
}

interface FutureAppointmentRow {
  public_reference: string
  status: AppointmentStatus
  start_at: number
  end_at: number
  duration_minutes_snapshot: number
}

export interface FutureStaffAppointment {
  publicReference: string
  status: 'pending' | 'confirmed'
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  durationMinutes: number
}

export interface AvailabilityDayContext {
  staff: AvailabilityStaff[]
  confirmedAppointments: ConfirmedAppointment[]
}

function toWorkingHour(row: WorkingHourRow): WorkingHour {
  return {
    id: row.id,
    weekday: row.weekday,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
  }
}

function toTimeOff(row: TimeOffRow): TimeOff {
  return {
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    reason: row.reason,
  }
}

export class SchedulesRepository {
  constructor(private readonly db: D1Database) {}

  async findStaffMember(userId: string): Promise<StaffRow | null> {
    return this.db
      .prepare(
        `SELECT u.id, u.name, u.email
           FROM users u
           JOIN staff_profiles p ON p.user_id = u.id
          WHERE u.id = ?
            AND u.role = 'staff'
            AND u.is_active = 1`,
      )
      .bind(userId)
      .first<StaffRow>()
  }

  async listWorkingHours(staffUserId: string): Promise<WorkingHour[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, weekday, start_minute, end_minute
           FROM staff_working_hours
          WHERE staff_user_id = ?
          ORDER BY weekday ASC, start_minute ASC, id ASC`,
      )
      .bind(staffUserId)
      .all<WorkingHourRow>()

    return results.map(toWorkingHour)
  }

  async listActiveStaff(): Promise<StaffRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT u.id, u.name, u.email
           FROM users u
           JOIN staff_profiles p ON p.user_id = u.id
          WHERE u.role = 'staff' AND u.is_active = 1
          ORDER BY u.name ASC, u.id ASC`,
      )
      .all<StaffRow>()

    return results
  }

  async listTimeOff(staffUserId: string): Promise<TimeOff[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, start_at, end_at, reason
           FROM staff_time_off
          WHERE staff_user_id = ?
          ORDER BY start_at ASC, id ASC`,
      )
      .bind(staffUserId)
      .all<TimeOffRow>()

    return results.map(toTimeOff)
  }

  async getSchedule(staffUserId: string): Promise<StaffSchedule | null> {
    const staff = await this.findStaffMember(staffUserId)
    if (!staff) return null

    const [workingHours, timeOff] = await Promise.all([
      this.listWorkingHours(staffUserId),
      this.listTimeOff(staffUserId),
    ])

    return { staff, workingHours, timeOff }
  }

  async replaceWorkingHours(
    staffUserId: string,
    intervals: Array<{ weekday: number; startMinute: number; endMinute: number }>,
  ): Promise<void> {
    const statements = [
      this.db
        .prepare('DELETE FROM staff_working_hours WHERE staff_user_id = ?')
        .bind(staffUserId),
    ]

    for (const interval of intervals) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO staff_working_hours (
               id, staff_user_id, weekday, start_minute, end_minute
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            randomId('hrs'),
            staffUserId,
            interval.weekday,
            interval.startMinute,
            interval.endMinute,
          ),
      )
    }

    await this.db.batch(statements)
  }

  async addTimeOff(input: {
    staffUserId: string
    startAt: number
    endAt: number
    reason: string | null
    now?: number
  }): Promise<TimeOff> {
    const id = randomId('tof')
    await this.db
      .prepare(
        `INSERT INTO staff_time_off (
           id, staff_user_id, start_at, end_at, reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.staffUserId,
        input.startAt,
        input.endAt,
        input.reason,
        input.now ?? unixSeconds(),
      )
      .run()

    const row = await this.db
      .prepare(
        `SELECT id, start_at, end_at, reason
           FROM staff_time_off
          WHERE id = ? AND staff_user_id = ?`,
      )
      .bind(id, input.staffUserId)
      .first<TimeOffRow>()

    if (!row) throw new Error('Created time off could not be read back.')
    return toTimeOff(row)
  }

  async deleteTimeOff(id: string, staffUserId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        'DELETE FROM staff_time_off WHERE id = ? AND staff_user_id = ?',
      )
      .bind(id, staffUserId)
      .run()

    return result.meta.changes > 0
  }

  async listFutureAppointments(
    staffUserId: string,
    now: number,
  ): Promise<FutureStaffAppointment[]> {
    const { results } = await this.db
      .prepare(
        `SELECT public_reference, status, start_at, end_at,
                duration_minutes_snapshot
           FROM appointments
          WHERE assigned_staff_user_id = ?
            AND status IN ('pending', 'confirmed')
            AND start_at > ?
          ORDER BY start_at ASC, id ASC`,
      )
      .bind(staffUserId, now)
      .all<FutureAppointmentRow>()

    return results.map((row) => ({
      publicReference: row.public_reference,
      status: row.status as 'pending' | 'confirmed',
      startAt: row.start_at,
      endAt: row.end_at,
      durationMinutes: row.duration_minutes_snapshot,
    }))
  }

  /** Confirmed overlaps for one staff member in a half-open range. */
  async listConfirmedBetween(
    staffUserId: string,
    start: number,
    end: number,
    excludeAppointmentId?: string,
  ): Promise<ConfirmedAppointment[]> {
    const excludeClause = excludeAppointmentId ? 'AND id <> ?' : ''
    const params = excludeAppointmentId
      ? [staffUserId, start, end, excludeAppointmentId]
      : [staffUserId, start, end]

    const { results } = await this.db
      .prepare(
        `SELECT assigned_staff_user_id, start_at, end_at
           FROM appointments
          WHERE assigned_staff_user_id = ?
            AND status = 'confirmed'
            AND end_at > ?
            AND start_at < ?
            ${excludeClause}
          ORDER BY start_at ASC, id ASC`,
      )
      .bind(...params)
      .all<ConfirmedAppointmentRow>()

    return results.map((row) => ({
      staffUserId: row.assigned_staff_user_id,
      startAt: row.start_at,
      endAt: row.end_at,
    }))
  }

  /**
   * Loads only the data needed to compute one day of public availability.
   * Inactive staff, non-staff users and non-confirmed bookings are excluded.
   */
  async loadAvailabilityDay(
    weekday: number,
    dayStart: number,
    dayEnd: number,
  ): Promise<AvailabilityDayContext> {
    const [staffResult, hoursResult, timeOffResult, appointmentResult] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT u.id
               FROM users u
               JOIN staff_profiles p ON p.user_id = u.id
              WHERE u.role = 'staff' AND u.is_active = 1
              ORDER BY u.id ASC`,
          )
          .all<{ id: string }>(),
        this.db
          .prepare(
            `SELECT h.staff_user_id, h.weekday, h.start_minute, h.end_minute
               FROM staff_working_hours h
               JOIN users u ON u.id = h.staff_user_id
               JOIN staff_profiles p ON p.user_id = u.id
              WHERE h.weekday = ?
                AND u.role = 'staff'
                AND u.is_active = 1
              ORDER BY h.staff_user_id ASC, h.start_minute ASC`,
          )
          .bind(weekday)
          .all<StaffWorkingHourRow>(),
        this.db
          .prepare(
            `SELECT t.staff_user_id, t.start_at, t.end_at
               FROM staff_time_off t
               JOIN users u ON u.id = t.staff_user_id
               JOIN staff_profiles p ON p.user_id = u.id
              WHERE u.role = 'staff'
                AND u.is_active = 1
                AND t.end_at > ?
                AND t.start_at < ?
              ORDER BY t.staff_user_id ASC, t.start_at ASC`,
          )
          .bind(dayStart, dayEnd)
          .all<StaffTimeOffRow>(),
        this.db
          .prepare(
            `SELECT a.assigned_staff_user_id, a.start_at, a.end_at
               FROM appointments a
               JOIN users u ON u.id = a.assigned_staff_user_id
               JOIN staff_profiles p ON p.user_id = u.id
              WHERE a.status = 'confirmed'
                AND u.role = 'staff'
                AND u.is_active = 1
                AND a.end_at > ?
                AND a.start_at < ?
              ORDER BY a.start_at ASC, a.id ASC`,
          )
          .bind(dayStart, dayEnd)
          .all<ConfirmedAppointmentRow>(),
      ])

    const staffById = new Map<string, AvailabilityStaff>()
    for (const row of staffResult.results) {
      staffById.set(row.id, { id: row.id, workingHours: [], timeOff: [] })
    }
    for (const row of hoursResult.results) {
      staffById.get(row.staff_user_id)?.workingHours.push({
        weekday: row.weekday,
        startMinute: row.start_minute,
        endMinute: row.end_minute,
      })
    }
    for (const row of timeOffResult.results) {
      staffById.get(row.staff_user_id)?.timeOff.push({
        startAt: row.start_at,
        endAt: row.end_at,
      })
    }

    return {
      staff: [...staffById.values()],
      confirmedAppointments: appointmentResult.results.map((row) => ({
        staffUserId: row.assigned_staff_user_id,
        startAt: row.start_at,
        endAt: row.end_at,
      })),
    }
  }

  async loadAvailabilitySpan(
    spanStart: number,
    spanEnd: number,
  ): Promise<AvailabilityDayContext> {
    const [staffResult, hoursResult, timeOffResult, appointmentResult] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT u.id
               FROM users u
               JOIN staff_profiles p ON p.user_id = u.id
              WHERE u.role = 'staff' AND u.is_active = 1
              ORDER BY u.id ASC`,
          )
          .all<{ id: string }>(),
        this.db
          .prepare(
            `SELECT h.staff_user_id, h.weekday, h.start_minute, h.end_minute
               FROM staff_working_hours h
               JOIN users u ON u.id = h.staff_user_id
               JOIN staff_profiles p ON p.user_id = u.id
              WHERE u.role = 'staff'
                AND u.is_active = 1
              ORDER BY h.staff_user_id ASC, h.weekday ASC, h.start_minute ASC`,
          )
          .all<StaffWorkingHourRow>(),
        this.db
          .prepare(
            `SELECT t.staff_user_id, t.start_at, t.end_at
               FROM staff_time_off t
               JOIN users u ON u.id = t.staff_user_id
               JOIN staff_profiles p ON p.user_id = u.id
              WHERE u.role = 'staff'
                AND u.is_active = 1
                AND t.end_at > ?
                AND t.start_at < ?
              ORDER BY t.staff_user_id ASC, t.start_at ASC`,
          )
          .bind(spanStart, spanEnd)
          .all<StaffTimeOffRow>(),
        this.db
          .prepare(
            `SELECT a.assigned_staff_user_id, a.start_at, a.end_at
               FROM appointments a
               JOIN users u ON u.id = a.assigned_staff_user_id
               JOIN staff_profiles p ON p.user_id = u.id
              WHERE a.status = 'confirmed'
                AND u.role = 'staff'
                AND u.is_active = 1
                AND a.end_at > ?
                AND a.start_at < ?
              ORDER BY a.start_at ASC, a.id ASC`,
          )
          .bind(spanStart, spanEnd)
          .all<ConfirmedAppointmentRow>(),
      ])

    const staffById = new Map<string, AvailabilityStaff>()
    for (const row of staffResult.results) {
      staffById.set(row.id, { id: row.id, workingHours: [], timeOff: [] })
    }
    for (const row of hoursResult.results) {
      staffById.get(row.staff_user_id)?.workingHours.push({
        weekday: row.weekday,
        startMinute: row.start_minute,
        endMinute: row.end_minute,
      })
    }
    for (const row of timeOffResult.results) {
      staffById.get(row.staff_user_id)?.timeOff.push({
        startAt: row.start_at,
        endAt: row.end_at,
      })
    }

    return {
      staff: [...staffById.values()],
      confirmedAppointments: appointmentResult.results.map((row) => ({
        staffUserId: row.assigned_staff_user_id,
        startAt: row.start_at,
        endAt: row.end_at,
      })),
    }
  }
}
