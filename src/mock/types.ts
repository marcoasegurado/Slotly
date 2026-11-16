/**
 * Domain types shared by the mock data layer and the UI.
 *
 * These mirror the proposed D1 schema in docs/DATABASE.md, field for field,
 * so the mock repository can be replaced by real API calls without changing
 * component code.
 */

export type Role = 'customer' | 'staff' | 'admin'

export type AppointmentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'

export interface Business {
  businessName: string
  businessEmail: string | null
  timezone: string
  maxAdvanceBookingDays: number
}

export interface Service {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  isActive: boolean
}

/** Weekly availability interval. Weekday 0 = Sunday … 6 = Saturday. */
export interface WorkingInterval {
  weekday: number
  startMinute: number
  endMinute: number
}

export interface TimeOff {
  id: string
  staffId: string
  startAt: string
  endAt: string
  reason?: string
}

export interface StaffMember {
  id: string
  name: string
  email: string
  /** Demo-only plaintext credential. Never store passwords like this in production. */
  password: string
  isActive: boolean
  intervals: WorkingInterval[]
  timeOff: TimeOff[]
}

export interface Customer {
  id: string
  name: string
  email: string
  password: string
}

/** Mock session shape. The real Worker stores an opaque server-side session. */
export interface MockSession {
  role: Role
  id: string
}

export interface Appointment {
  id: string
  publicReference: string
  customerUserId: string | null
  guestName: string | null
  guestEmail: string | null
  serviceId: string
  serviceNameSnapshot: string
  durationMinutesSnapshot: number
  assignedStaffUserId: string
  startAt: string
  endAt: string
  status: AppointmentStatus
  customerNote: string | null
  resolutionNote: string | null
  createdAt: string
  updatedAt: string
}

export interface GuestCancellationToken {
  token: string
  appointmentId: string
  expiresAt: string
  usedAt: string | null
}

export interface Slot {
  startAt: string
  endAt: string
  staffId: string
}

export type DayAvailabilityState =
  | 'open'
  | 'closed'   // no staff works this weekday
  | 'full'     // everyone works but every slot is taken or in the past
  | 'past'
  | 'outside-booking-window'

export interface DayAvailability {
  dateKey: string
  state: DayAvailabilityState
  slots: Slot[]
}
