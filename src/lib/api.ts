/**
 * Typed client for the Slotly Worker API.
 *
 * Every response is the Worker's `{ data }` envelope, and every failure is
 * `{ error: { code, message, details } }`. Instants stay as Unix seconds here;
 * the display layer converts them with `src/lib/time.ts`.
 *
 * Requests are same-origin, so `credentials: 'include'` sends the HttpOnly
 * session cookie and the browser adds the `Origin` header the Worker's CSRF
 * check expects.
 */

import type { Business, Service } from './types'

export type Role = 'customer' | 'staff' | 'admin'
export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
  mustChangePassword: boolean
}

export type { Business, Service } from './types'

export type AvailabilityState =
  | 'past'
  | 'outside-booking-window'
  | 'closed'
  | 'open'
  | 'full'

export interface AvailabilitySlot {
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
}

export interface DayAvailability {
  dateKey: string
  state: AvailabilityState
  slots: AvailabilitySlot[]
}

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

export interface StatusCounts {
  pending: number
  confirmed: number
  rejected: number
  cancelled: number
}

export interface AdminDashboard {
  /** Unix seconds. */
  asOf: number
  dateKey: string
  timezone: string
  totals: StatusCounts
  today: StatusCounts
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

export interface ReportSummary {
  range: {
    from: string | null
    to: string | null
    timezone: string
  }
  filters: {
    serviceId: string | null
    staffId: string | null
    status: AppointmentStatus | null
  }
  totals: StatusCounts & { appointments: number }
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

export interface ActiveStaffMember {
  id: string
  name: string
  email: string
}

export interface AffectedBooking {
  publicReference: string
  status: 'pending' | 'confirmed'
  /** Unix seconds. */
  startAt: number
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Returns `null` for 401 instead of throwing. Used for the session probe. */
  allowUnauthenticated?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    )
  }

  if (response.status === 401 && options.allowUnauthenticated) {
    return null as T
  }

  if (response.status === 204) {
    return null as T
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const error = isRecord(body) ? body.error : undefined
    throw new ApiError(
      response.status,
      isRecord(error) && typeof error.code === 'string'
        ? error.code
        : 'REQUEST_FAILED',
      isRecord(error) && typeof error.message === 'string'
        ? error.message
        : 'The request could not be completed.',
      isRecord(error) && isRecord(error.details) ? error.details : {},
    )
  }

  if (!isRecord(body) || !('data' in body)) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an unexpected response.',
    )
  }

  return body.data as T
}

// ---------------------------------------------------------------- public ---

export function getBusiness(): Promise<Business> {
  return request<Business>('/api/public/business')
}

export function listServices(): Promise<Service[]> {
  return request<Service[]>('/api/public/services')
}

export function getAvailability(
  serviceId: string,
  dateKey: string,
): Promise<DayAvailability> {
  const query = new URLSearchParams({ serviceId, date: dateKey })
  return request<DayAvailability>(`/api/public/availability?${query}`)
}

export interface MonthAvailability {
  month: string
  days: Array<{ dateKey: string; state: AvailabilityState }>
}

export function getMonthAvailability(
  serviceId: string,
  month: string,
): Promise<MonthAvailability> {
  const query = new URLSearchParams({ serviceId, month })
  return request<MonthAvailability>(`/api/public/availability/month?${query}`)
}

export interface CreateBookingInput {
  serviceId: string
  /** Unix seconds. */
  startAt: number
  guestName?: string
  guestEmail?: string
  customerNote?: string
}

export function createBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  return request<CreateBookingResult>('/api/public/bookings', {
    method: 'POST',
    body: input,
  })
}

export function cancelGuestBooking(
  token: string,
): Promise<{ publicReference: string }> {
  return request<{ publicReference: string }>('/api/public/guest-cancellation', {
    method: 'POST',
    body: { token },
  })
}

/** Safe summary for the read-only confirmation page. */
export function resolveGuestCancellation(
  token: string,
): Promise<{
  publicReference: string
  serviceName: string
  durationMinutes: number
  startAt: number
  endAt: number
}> {
  return request(`/api/public/guest-cancellation/${encodeURIComponent(token)}`)
}

// ------------------------------------------------------------------ auth ---

export function getSession(): Promise<AuthUser | null> {
  return request<AuthUser | null>('/api/auth/me', { allowUnauthenticated: true })
}

export function login(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

export function register(input: {
  name: string
  email: string
  password: string
}): Promise<AuthUser> {
  return request<AuthUser>('/api/auth/register', {
    method: 'POST',
    body: input,
  })
}

export function logout(): Promise<null> {
  return request<null>('/api/auth/logout', { method: 'POST' })
}

/**
 * The Worker answers `204 No Content` and keeps the current session, so the
 * caller must re-read `/api/auth/me` instead of expecting a user payload.
 */
export function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<null> {
  return request<null>('/api/auth/change-password', {
    method: 'POST',
    body: input,
  })
}

// -------------------------------------------------------------- customer ---

export function listMyBookings(): Promise<CustomerBookings> {
  return request<CustomerBookings>('/api/customer/bookings')
}

export function getMyBooking(publicReference: string): Promise<Booking> {
  return request<Booking>(
    `/api/customer/bookings/${encodeURIComponent(publicReference)}`,
  )
}

export function cancelMyBooking(publicReference: string): Promise<Booking> {
  return request<Booking>(
    `/api/customer/bookings/${encodeURIComponent(publicReference)}/cancel`,
    { method: 'POST' },
  )
}

// ----------------------------------------------------------------- staff ---

export function getStaffDashboard(): Promise<StaffDashboard> {
  return request<StaffDashboard>('/api/staff/dashboard')
}

export function listStaffAppointments(query: {
  status?: AppointmentStatus
  scope?: 'today' | 'upcoming' | 'all'
} = {}): Promise<ManagedAppointment[]> {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.scope) params.set('scope', query.scope)
  const suffix = params.size > 0 ? `?${params}` : ''
  return request<ManagedAppointment[]>(`/api/staff/appointments${suffix}`)
}

export function getStaffAppointment(
  publicReference: string,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/staff/appointments/${encodeURIComponent(publicReference)}`,
  )
}

export function approveStaffAppointment(
  publicReference: string,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/staff/appointments/${encodeURIComponent(publicReference)}/approve`,
    { method: 'POST' },
  )
}

export function rejectStaffAppointment(
  publicReference: string,
  reason?: string | null,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/staff/appointments/${encodeURIComponent(publicReference)}/reject`,
    { method: 'POST', body: reason ? { reason } : {} },
  )
}

export function cancelStaffAppointment(
  publicReference: string,
  reason?: string | null,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/staff/appointments/${encodeURIComponent(publicReference)}/cancel`,
    { method: 'POST', body: reason ? { reason } : {} },
  )
}

export function rescheduleStaffAppointment(
  publicReference: string,
  startAt: number,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/staff/appointments/${encodeURIComponent(publicReference)}`,
    { method: 'PATCH', body: { startAt } },
  )
}

export function getMySchedule(): Promise<StaffSchedule> {
  return request<StaffSchedule>('/api/staff/availability')
}

export function updateMySchedule(
  workingHours: Array<{ weekday: number; startMinute: number; endMinute: number }>,
): Promise<StaffSchedule> {
  return request<StaffSchedule>('/api/staff/availability', {
    method: 'PUT',
    body: { workingHours },
  })
}

export function addMyTimeOff(input: {
  startAt: number
  endAt: number
  reason?: string | null
}): Promise<TimeOff> {
  return request<TimeOff>('/api/staff/time-off', {
    method: 'POST',
    body: input,
  })
}

export function removeMyTimeOff(id: string): Promise<null> {
  return request<null>(`/api/staff/time-off/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// ----------------------------------------------------------------- admin ---

export function getAdminDashboard(): Promise<AdminDashboard> {
  return request<AdminDashboard>('/api/admin/dashboard')
}

export function listAdminAppointments(query: {
  status?: AppointmentStatus | null
  serviceId?: string | null
  staffId?: string | null
  /** Business-local date key, `YYYY-MM-DD`. */
  date?: string | null
  q?: string | null
  limit?: number | null
} = {}): Promise<ManagedAppointment[]> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, String(value))
    }
  }
  const suffix = params.size > 0 ? `?${params}` : ''
  return request<ManagedAppointment[]>(`/api/admin/appointments${suffix}`)
}

export function approveAdminAppointment(
  publicReference: string,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/admin/appointments/${encodeURIComponent(publicReference)}/approve`,
    { method: 'POST' },
  )
}

export function rejectAdminAppointment(
  publicReference: string,
  reason?: string | null,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/admin/appointments/${encodeURIComponent(publicReference)}/reject`,
    { method: 'POST', body: reason ? { reason } : {} },
  )
}

export function cancelAdminAppointment(
  publicReference: string,
  reason?: string | null,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/admin/appointments/${encodeURIComponent(publicReference)}/cancel`,
    { method: 'POST', body: reason ? { reason } : {} },
  )
}

export function rescheduleAdminAppointment(
  publicReference: string,
  startAt: number,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/admin/appointments/${encodeURIComponent(publicReference)}`,
    { method: 'PATCH', body: { startAt } },
  )
}

export function reassignAdminAppointment(
  publicReference: string,
  input: { staffId: string; startAt?: number },
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/admin/appointments/${encodeURIComponent(publicReference)}/reassign`,
    { method: 'POST', body: input },
  )
}

export function getAdminAppointment(
  publicReference: string,
): Promise<ManagedAppointment> {
  return request<ManagedAppointment>(
    `/api/admin/appointments/${encodeURIComponent(publicReference)}`,
  )
}

export function listActiveStaff(): Promise<ActiveStaffMember[]> {
  return request<ActiveStaffMember[]>('/api/admin/staff')
}

export function listAdminServices(): Promise<Service[]> {
  return request<Service[]>('/api/admin/services')
}

export function createService(input: {
  name: string
  description?: string | null
  durationMinutes: number
  isActive?: boolean
}): Promise<Service> {
  return request<Service>('/api/admin/services', {
    method: 'POST',
    body: input,
  })
}

export function updateService(
  id: string,
  input: {
    name?: string
    description?: string | null
    durationMinutes?: number
    isActive?: boolean
  },
): Promise<Service> {
  return request<Service>(`/api/admin/services/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  })
}

export function getReportSummary(query: {
  from?: string
  to?: string
  serviceId?: string
  staffId?: string
  status?: AppointmentStatus
} = {}): Promise<ReportSummary> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value)
  }
  const suffix = params.size > 0 ? `?${params}` : ''
  return request<ReportSummary>(`/api/admin/reports/summary${suffix}`)
}
