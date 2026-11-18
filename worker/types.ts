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

/**
 * Customer/guest-safe booking shape. Internal user IDs and the assigned staff
 * member are intentionally omitted; the public reference is the identifier.
 */
export interface Booking {
  publicReference: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  status: AppointmentStatus
  customerNote: string | null
  resolutionNote: string | null
  guestName: string | null
  guestEmail: string | null
  /** Unix seconds. */
  createdAt: number
  /** Unix seconds. */
  updatedAt: number
}

export interface CreateBookingResult {
  appointment: Booking
  /** Returned once for guest bookings; null for customer bookings. */
  cancellationToken: string | null
}

export interface CustomerBookings {
  upcoming: Booking[]
  past: Booking[]
}

/** Staff/admin-facing booking detail. Internal row IDs stay in the repository. */
export interface ManagedAppointment {
  publicReference: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  assignedStaff: {
    id: string
    name: string
    email: string
  }
  customer: {
    name: string
    email: string
  } | null
  guestName: string | null
  guestEmail: string | null
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  status: AppointmentStatus
  customerNote: string | null
  resolutionNote: string | null
  /** Unix seconds. */
  createdAt: number
  /** Unix seconds. */
  updatedAt: number
  /** Unix seconds. */
  approvedAt: number | null
  /** Unix seconds. */
  cancelledAt: number | null
}

export interface StaffDashboard {
  pending: ManagedAppointment[]
  today: ManagedAppointment[]
  upcoming: ManagedAppointment[]
  counts: {
    pending: number
    today: number
    confirmedUpcoming: number
  }
}

/** Appointment counts for each status in the schema. */
export interface StatusCounts {
  pending: number
  confirmed: number
  rejected: number
  cancelled: number
}

export interface AdminDashboard {
  /** Unix seconds. */
  asOf: number
  /** Business-local date key for `today`. */
  dateKey: string
  timezone: string
  /** All appointments, regardless of date. */
  totals: StatusCounts
  /** Appointments starting inside the current business-local day. */
  today: StatusCounts
  /** Pending/confirmed appointments ending after `asOf`. */
  upcoming: {
    pending: number
    confirmed: number
  }
  staff: Array<{
    id: string
    name: string
    pending: number
    confirmedUpcoming: number
  }>
}

export interface ReportTotals extends StatusCounts {
  appointments: number
}

export interface ReportSummary {
  range: {
    /** Business-local date keys, inclusive; null when unbounded. */
    from: string | null
    to: string | null
    timezone: string
  }
  filters: {
    serviceId: string | null
    staffId: string | null
    status: AppointmentStatus | null
  }
  totals: ReportTotals
  byService: Array<{
    serviceId: string
    serviceName: string
    total: number
    counts: StatusCounts
  }>
  byStaff: Array<{
    staffId: string
    name: string
    total: number
    counts: StatusCounts
  }>
}
