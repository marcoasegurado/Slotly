/**
 * API-facing shapes. Database columns stay snake_case inside repositories;
 * these camelCase types are the contract shared with the React client.
 */

export type UserRole = 'customer' | 'staff' | 'admin'
export type AppointmentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  mustChangePassword: boolean
}

export interface PublicBusiness {
  businessName: string
  businessEmail: string | null
  timezone: string
  maxAdvanceBookingDays: number
}

export interface PublicService {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  isActive: boolean
}

export type AvailabilityState =
  | 'past'
  | 'outside-booking-window'
  | 'closed'
  | 'open'
  | 'full'

/** Public slots intentionally omit the assigned staff member. */
export interface AvailabilitySlot {
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
}

export interface PublicDayAvailability {
  dateKey: string
  state: AvailabilityState
  slots: AvailabilitySlot[]
}

export interface WorkingHour {
  id: string
  weekday: number
  startMinute: number
  endMinute: number
}

export interface TimeOff {
  id: string
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  reason: string | null
}

export interface StaffSchedule {
  staff: {
    id: string
    name: string
    email: string
  }
  workingHours: WorkingHour[]
  timeOff: TimeOff[]
}

export interface AffectedBooking {
  publicReference: string
  status: AppointmentStatus
  /** Unix seconds. */
  startAt: number
}
