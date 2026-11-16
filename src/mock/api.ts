/**
 * Mock repository.
 *
 * Every function here has the shape of a future Worker endpoint from
 * docs/API.md (`GET /api/public/availability`, `POST /api/public/bookings`, …).
 * Swapping this file for `fetch` calls should not require component changes.
 *
 * Nothing here is production logic: there is no password hashing, the data is
 * held in memory, and it resets on reload.
 */
import {
  findScheduleConflicts,
  getDayAvailability,
  validateSlot,
  validateStaffSlotForDuration,
} from '../lib/availability'
import type { AvailabilityContext } from '../lib/availability'
import { todayDateKey, toDateKey } from '../lib/time'
import { emit, getDb } from './store'
import {
  newCancellationToken,
  newId,
  newPublicReference,
  type MockDatabase,
} from './seed'
import type {
  Appointment,
  AppointmentStatus,
  Business,
  Customer,
  DayAvailability,
  Role,
  Service,
  Slot,
  StaffMember,
  TimeOff,
  WorkingInterval,
} from './types'

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'SLOT_UNAVAILABLE'
  | 'BOOKING_CONFLICT'
  | 'SCHEDULE_CHANGE_CONFLICT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'

export interface ApiErrorDetails {
  affectedAppointments?: Appointment[]
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly details: ApiErrorDetails

  constructor(code: ApiErrorCode, message: string, details: ApiErrorDetails = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
}

export const GUEST_TOKEN_TTL_HOURS = 72

function context(db: MockDatabase): AvailabilityContext {
  return {
    business: db.business,
    staff: db.staff,
    appointments: db.appointments,
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function sessionUser(db: MockDatabase): SessionUser | null {
  if (!db.session) return null

  if (db.session.role === 'customer') {
    const customer = db.customers.find((entry) => entry.id === db.session?.id)
    if (!customer) return null
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      role: 'customer',
    }
  }

  const staff = db.staff.find((entry) => entry.id === db.session?.id)
  if (!staff || !staff.isActive) return null
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: db.session.role,
  }
}

function currentCustomer(db: MockDatabase): Customer | null {
  if (!db.session || db.session.role !== 'customer') return null
  return db.customers.find((entry) => entry.id === db.session?.id) ?? null
}

function requireStaff(db: MockDatabase): StaffMember {
  const session = sessionUser(db)
  if (!session) {
    throw new ApiError('UNAUTHENTICATED', 'Sign in to open the staff workspace.')
  }
  if (session.role !== 'staff') {
    throw new ApiError('FORBIDDEN', 'This area is only available to staff accounts.')
  }

  const staff = db.staff.find((entry) => entry.id === session.id)
  if (!staff || !staff.isActive) {
    throw new ApiError('FORBIDDEN', 'This staff account is not active.')
  }
  return staff
}

function assignedAppointment(db: MockDatabase, staff: StaffMember, id: string): Appointment {
  const appointment = db.appointments.find((entry) => entry.id === id)
  if (!appointment || appointment.assignedStaffUserId !== staff.id) {
    throw new ApiError('NOT_FOUND', 'That appointment is not assigned to you.')
  }
  return appointment
}

/* ---------------- Business & catalogue ---------------- */

export async function getBusiness(): Promise<Business> {
  return getDb().business
}

export async function listServices(): Promise<Service[]> {
  return getDb()
    .services.filter((service) => service.isActive)
    .slice()
    .sort((a, b) => a.durationMinutes - b.durationMinutes)
}

export async function getService(serviceId: string): Promise<Service | null> {
  return getDb().services.find((service) => service.id === serviceId) ?? null
}

/* ---------------- Availability ---------------- */

export async function getAvailability(
  serviceId: string,
  dateKey: string,
  now: Date = new Date(),
): Promise<DayAvailability> {
  const db = getDb()
  const service = db.services.find((entry) => entry.id === serviceId)
  if (!service || !service.isActive) {
    throw new ApiError('SERVICE_UNAVAILABLE', 'That service is not currently bookable.')
  }
  return getDayAvailability(context(db), service, dateKey, now)
}

export async function getTodayKey(): Promise<string> {
  return todayDateKey(getDb().business.timezone)
}

/* ---------------- Bookings ---------------- */

export interface CreateBookingInput {
  serviceId: string
  startAt: string
  mode: 'guest' | 'customer'
  guestName?: string
  guestEmail?: string
  customerNote?: string
}

export interface CreateBookingResult {
  appointment: Appointment
  cancellationToken: string | null
}

export async function createBooking(
  input: CreateBookingInput,
  now: Date = new Date(),
): Promise<CreateBookingResult> {
  const db = getDb()
  const service = db.services.find((entry) => entry.id === input.serviceId)

  if (!service || !service.isActive) {
    throw new ApiError('SERVICE_UNAVAILABLE', 'That service is not currently bookable.')
  }

  const startAt = Date.parse(input.startAt)
  if (!Number.isFinite(startAt)) {
    throw new ApiError('VALIDATION_ERROR', 'Choose a valid start time.')
  }
  if (startAt <= now.getTime()) {
    throw new ApiError('VALIDATION_ERROR', 'Choose a time in the future.')
  }

  const note = input.customerNote?.trim() || null
  if (note && note.length > 500) {
    throw new ApiError('VALIDATION_ERROR', 'Keep your note under 500 characters.')
  }

  let customerUserId: string | null = null
  let guestName: string | null = null
  let guestEmail: string | null = null

  if (input.mode === 'customer') {
    const customer = currentCustomer(db)
    if (!customer) {
      throw new ApiError(
        'UNAUTHENTICATED',
        'Sign in with a customer account again to book this appointment.',
      )
    }
    customerUserId = customer.id
    guestName = customer.name
    guestEmail = customer.email
  } else {
    const name = input.guestName?.trim() ?? ''
    const email = normalizeEmail(input.guestEmail ?? '')
    if (name.length < 2) {
      throw new ApiError('VALIDATION_ERROR', 'Enter your full name.')
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError('VALIDATION_ERROR', 'Enter a valid email address.')
    }
    guestName = name
    guestEmail = email
  }

  // Server-side re-validation: the check immediately before the write is the
  // one that counts. A client cannot force a slot, a duration or a staff member.
  const slot = validateSlot(context(db), service, new Date(startAt).toISOString(), now)
  if (!slot) {
    throw new ApiError(
      'BOOKING_CONFLICT',
      'That time is no longer available. Choose another time.',
    )
  }

  const appointment: Appointment = {
    id: newId('apt'),
    publicReference: newPublicReference(),
    customerUserId,
    guestName,
    guestEmail,
    serviceId: service.id,
    serviceNameSnapshot: service.name,
    durationMinutesSnapshot: service.durationMinutes,
    assignedStaffUserId: slot.staffId,
    startAt: slot.startAt,
    endAt: slot.endAt,
    status: 'pending',
    customerNote: note,
    resolutionNote: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  db.appointments.push(appointment)

  // Guests get a private cancellation link. Only the hash is persisted in the
  // real system; the mock keeps the token so the demo link keeps working.
  let cancellationToken: string | null = null
  if (!customerUserId) {
    cancellationToken = newCancellationToken()
    const ttlMs = GUEST_TOKEN_TTL_HOURS * 60 * 60 * 1000
    const expiresAt = Math.min(
      Date.parse(appointment.startAt),
      now.getTime() + ttlMs,
    )
    db.cancellationTokens.push({
      token: cancellationToken,
      appointmentId: appointment.id,
      expiresAt: new Date(expiresAt).toISOString(),
      usedAt: null,
    })
  }

  emit()
  return { appointment, cancellationToken }
}

export async function getAppointment(reference: string): Promise<Appointment | null> {
  return (
    getDb().appointments.find(
      (appointment) =>
        appointment.publicReference === reference.toUpperCase() ||
        appointment.id === reference,
    ) ?? null
  )
}

export interface BookingLists {
  upcoming: Appointment[]
  past: Appointment[]
}

export async function listMyBookings(): Promise<BookingLists> {
  const db = getDb()
  const customer = currentCustomer(db)
  if (!customer) {
    throw new ApiError('UNAUTHENTICATED', 'Sign in to see your appointments.')
  }

  const mine = db.appointments
    .filter((appointment) => appointment.customerUserId === customer.id)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))

  const now = Date.now()
  const isUpcoming = (appointment: Appointment) => {
    if (appointment.status === 'pending') return true
    if (appointment.status === 'rejected' || appointment.status === 'cancelled') {
      return false
    }
    return Date.parse(appointment.endAt) > now
  }

  return {
    upcoming: mine.filter(isUpcoming).reverse(),
    past: mine.filter((appointment) => !isUpcoming(appointment)).reverse(),
  }
}

export async function cancelMyBooking(appointmentId: string): Promise<Appointment> {
  const db = getDb()
  const customer = currentCustomer(db)
  if (!customer) {
    throw new ApiError('UNAUTHENTICATED', 'Sign in to cancel your appointment.')
  }

  const appointment = db.appointments.find((entry) => entry.id === appointmentId)
  if (!appointment || appointment.customerUserId !== customer.id) {
    throw new ApiError('NOT_FOUND', 'That appointment is not available.')
  }
  if (appointment.status !== 'pending') {
    throw new ApiError(
      'FORBIDDEN',
      'Only a pending request can be cancelled here. Contact the business to change a confirmed appointment.',
    )
  }

  appointment.status = 'cancelled'
  appointment.resolutionNote = 'Cancelled by customer'
  appointment.updatedAt = new Date().toISOString()
  emit()
  return appointment
}

/* ---------------- Guest cancellation ---------------- */

export type GuestTokenState = 'valid' | 'unavailable'

export interface GuestTokenResult {
  state: GuestTokenState
  appointment: Appointment | null
}

export async function resolveGuestToken(
  token: string,
  now: Date = new Date(),
): Promise<GuestTokenResult> {
  const db = getDb()
  const entry = db.cancellationTokens.find((record) => record.token === token)
  if (!entry) return { state: 'unavailable', appointment: null }
  if (entry.usedAt) return { state: 'unavailable', appointment: null }
  if (Date.parse(entry.expiresAt) <= now.getTime()) {
    return { state: 'unavailable', appointment: null }
  }

  const appointment = db.appointments.find((record) => record.id === entry.appointmentId)
  if (!appointment || appointment.status !== 'pending') {
    return { state: 'unavailable', appointment: null }
  }

  return { state: 'valid', appointment }
}

export async function cancelGuestBooking(token: string): Promise<{ reference: string }> {
  const db = getDb()
  const result = await resolveGuestToken(token)
  if (result.state !== 'valid' || !result.appointment) {
    throw new ApiError('NOT_FOUND', 'This link is no longer available.')
  }

  const appointment = db.appointments.find((entry) => entry.id === result.appointment?.id)
  if (!appointment) {
    throw new ApiError('NOT_FOUND', 'This link is no longer available.')
  }

  appointment.status = 'cancelled'
  appointment.resolutionNote = 'Cancelled by guest'
  appointment.updatedAt = new Date().toISOString()

  const entry = db.cancellationTokens.find((record) => record.token === token)
  if (entry) entry.usedAt = new Date().toISOString()

  emit()
  return { reference: appointment.publicReference }
}

/* ---------------- Auth ---------------- */

export async function register(input: {
  name: string
  email: string
  password: string
}): Promise<SessionUser> {
  const db = getDb()
  const email = normalizeEmail(input.email)
  const name = input.name.trim()

  if (name.length < 2) {
    throw new ApiError('VALIDATION_ERROR', 'Enter your full name.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError('VALIDATION_ERROR', 'Enter a valid email address.')
  }
  if (input.password.length < 8) {
    throw new ApiError('VALIDATION_ERROR', 'Use at least 8 characters for your password.')
  }

  const emailTaken =
    db.customers.some((customer) => customer.email === email) ||
    db.staff.some((member) => member.email === email)
  if (emailTaken) {
    throw new ApiError('EMAIL_IN_USE', 'An account with that email already exists.')
  }

  const customer: Customer = {
    id: newId('cus'),
    name,
    email,
    password: input.password,
  }
  db.customers.push(customer)
  db.session = { role: 'customer', id: customer.id }
  emit()
  return { id: customer.id, name: customer.name, email: customer.email, role: 'customer' }
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const db = getDb()
  const normalized = normalizeEmail(email)

  const customer = db.customers.find(
    (entry) => entry.email === normalized && entry.password === password,
  )
  if (customer) {
    db.session = { role: 'customer', id: customer.id }
    emit()
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      role: 'customer',
    }
  }

  const staff = db.staff.find(
    (entry) =>
      entry.email === normalized && entry.password === password && entry.isActive,
  )
  if (staff) {
    db.session = { role: 'staff', id: staff.id }
    emit()
    return { id: staff.id, name: staff.name, email: staff.email, role: 'staff' }
  }

  // Do not reveal whether the email exists or whether an account is inactive.
  throw new ApiError('INVALID_CREDENTIALS', 'That email and password do not match.')
}

export async function loginWithDemoAccount(): Promise<SessionUser> {
  return login('maria@example.com', 'slotly-demo')
}

export async function loginWithDemoStaffAccount(): Promise<SessionUser> {
  return login('ana@slotly.studio', 'slotly-demo')
}

export async function logout(): Promise<void> {
  getDb().session = null
  emit()
}

export async function getSession(): Promise<SessionUser | null> {
  return sessionUser(getDb())
}

/* ---------------- Staff workspace ---------------- */

export interface StaffAppointmentFilters {
  status?: AppointmentStatus | 'all'
  scope?: 'today' | 'upcoming' | 'all'
}

export interface StaffDashboard {
  pending: Appointment[]
  today: Appointment[]
  upcoming: Appointment[]
  counts: {
    pending: number
    today: number
    confirmedUpcoming: number
  }
}

export interface StaffAvailability {
  staffId: string
  intervals: WorkingInterval[]
  timeOff: TimeOff[]
}

function staffContext(db: MockDatabase): AvailabilityContext {
  return {
    business: db.business,
    staff: db.staff,
    appointments: db.appointments,
  }
}

function sortByStart(appointments: Appointment[]): Appointment[] {
  return appointments
    .slice()
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
}

function mineFor(db: MockDatabase, staffId: string): Appointment[] {
  return db.appointments.filter(
    (appointment) => appointment.assignedStaffUserId === staffId,
  )
}

export async function getStaffDashboard(): Promise<StaffDashboard> {
  const db = getDb()
  const staff = requireStaff(db)
  const now = Date.now()
  const today = todayDateKey(db.business.timezone)
  const mine = mineFor(db, staff.id)

  const pending = sortByStart(mine.filter((appointment) => appointment.status === 'pending'))
  const todayAppointments = sortByStart(
    mine.filter(
      (appointment) =>
        (appointment.status === 'pending' || appointment.status === 'confirmed') &&
        toDateKey(new Date(appointment.startAt), db.business.timezone) === today,
    ),
  )
  const upcoming = sortByStart(
    mine.filter(
      (appointment) =>
        appointment.status === 'confirmed' && Date.parse(appointment.endAt) > now,
    ),
  )

  return {
    pending,
    today: todayAppointments,
    upcoming,
    counts: {
      pending: pending.length,
      today: todayAppointments.length,
      confirmedUpcoming: upcoming.length,
    },
  }
}

export async function listStaffAppointments(
  filters: StaffAppointmentFilters = {},
): Promise<Appointment[]> {
  const db = getDb()
  const staff = requireStaff(db)
  const now = Date.now()
  const today = todayDateKey(db.business.timezone)
  const scope = filters.scope ?? 'all'

  return sortByStart(
    mineFor(db, staff.id).filter((appointment) => {
      if (filters.status && filters.status !== 'all') {
        if (appointment.status !== filters.status) return false
      }

      if (scope === 'today') {
        return toDateKey(new Date(appointment.startAt), db.business.timezone) === today
      }

      if (scope === 'upcoming') {
        return (
          Date.parse(appointment.endAt) > now &&
          (appointment.status === 'pending' || appointment.status === 'confirmed')
        )
      }

      return true
    }),
  )
}

export async function getStaffAppointment(id: string): Promise<Appointment> {
  const db = getDb()
  const staff = requireStaff(db)
  return assignedAppointment(db, staff, id)
}

export async function approveStaffAppointment(id: string): Promise<Appointment> {
  const db = getDb()
  const staff = requireStaff(db)
  const appointment = assignedAppointment(db, staff, id)
  const now = new Date()

  if (appointment.status !== 'pending') {
    throw new ApiError('BOOKING_CONFLICT', 'Only a pending request can be approved.')
  }
  if (Date.parse(appointment.startAt) <= now.getTime()) {
    throw new ApiError(
      'BOOKING_CONFLICT',
      'This request start time has passed. It cannot be approved; decline it instead.',
    )
  }

  const slot = validateStaffSlotForDuration(
    staffContext(db),
    staff,
    appointment.startAt,
    appointment.durationMinutesSnapshot,
    now,
    appointment.id,
  )

  if (!slot) {
    throw new ApiError(
      'BOOKING_CONFLICT',
      'This time conflicts with your working hours, time off, or a confirmed appointment. Choose another time or decline the request.',
    )
  }

  appointment.startAt = slot.startAt
  appointment.endAt = slot.endAt
  appointment.status = 'confirmed'
  appointment.resolutionNote = 'Approved'
  appointment.updatedAt = now.toISOString()
  emit()
  return appointment
}

export async function rejectStaffAppointment(
  id: string,
  reason?: string,
): Promise<Appointment> {
  const db = getDb()
  const staff = requireStaff(db)
  const appointment = assignedAppointment(db, staff, id)

  if (appointment.status !== 'pending') {
    throw new ApiError('BOOKING_CONFLICT', 'Only a pending request can be declined.')
  }

  const note = reason?.trim() || 'Declined by the team'
  if (note.length > 300) {
    throw new ApiError('VALIDATION_ERROR', 'Keep the reason under 300 characters.')
  }

  appointment.status = 'rejected'
  appointment.resolutionNote = note
  appointment.updatedAt = new Date().toISOString()
  emit()
  return appointment
}

export async function cancelStaffAppointment(
  id: string,
  reason?: string,
): Promise<Appointment> {
  const db = getDb()
  const staff = requireStaff(db)
  const appointment = assignedAppointment(db, staff, id)

  if (appointment.status !== 'confirmed') {
    throw new ApiError('BOOKING_CONFLICT', 'Only a confirmed appointment can be cancelled.')
  }

  const note = reason?.trim() || 'Cancelled by the team'
  if (note.length > 300) {
    throw new ApiError('VALIDATION_ERROR', 'Keep the reason under 300 characters.')
  }

  appointment.status = 'cancelled'
  appointment.resolutionNote = note
  appointment.updatedAt = new Date().toISOString()
  emit()
  return appointment
}

export async function rescheduleStaffAppointment(
  id: string,
  startAt: string,
): Promise<Appointment> {
  const db = getDb()
  const staff = requireStaff(db)
  const appointment = assignedAppointment(db, staff, id)

  if (appointment.status !== 'pending' && appointment.status !== 'confirmed') {
    throw new ApiError(
      'BOOKING_CONFLICT',
      'Only a pending or confirmed appointment can be rescheduled.',
    )
  }

  if (!Number.isFinite(Date.parse(startAt))) {
    throw new ApiError('VALIDATION_ERROR', 'Choose a valid new time.')
  }

  const slot = validateStaffSlotForDuration(
    staffContext(db),
    staff,
    startAt,
    appointment.durationMinutesSnapshot,
    new Date(),
    appointment.id,
  )

  if (!slot) {
    throw new ApiError(
      'BOOKING_CONFLICT',
      'That time is not available in your schedule. Choose another time.',
    )
  }

  appointment.startAt = slot.startAt
  appointment.endAt = slot.endAt
  appointment.updatedAt = new Date().toISOString()
  emit()
  return appointment
}

export async function getMyAvailability(): Promise<StaffAvailability> {
  const db = getDb()
  const staff = requireStaff(db)
  return {
    staffId: staff.id,
    intervals: staff.intervals.map((interval) => ({ ...interval })),
    timeOff: staff.timeOff.map((entry) => ({ ...entry })),
  }
}

function validateIntervals(intervals: WorkingInterval[]): WorkingInterval[] {
  for (const interval of intervals) {
    if (
      !Number.isInteger(interval.weekday) ||
      interval.weekday < 0 ||
      interval.weekday > 6
    ) {
      throw new ApiError('VALIDATION_ERROR', 'Choose a valid weekday.')
    }
    if (
      !Number.isInteger(interval.startMinute) ||
      !Number.isInteger(interval.endMinute) ||
      interval.startMinute < 0 ||
      interval.endMinute > 1440 ||
      interval.startMinute >= interval.endMinute
    ) {
      throw new ApiError('VALIDATION_ERROR', 'Each interval must end after it starts.')
    }
  }

  const sorted = intervals
    .slice()
    .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (previous.weekday === current.weekday && current.startMinute < previous.endMinute) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'Working intervals on the same day cannot overlap.',
      )
    }
  }

  return sorted
}

export async function updateMyAvailability(
  intervals: WorkingInterval[],
): Promise<StaffAvailability> {
  const db = getDb()
  const staff = requireStaff(db)
  const normalized = validateIntervals(intervals)

  const conflicts = findScheduleConflicts(staffContext(db), staff, {
    intervals: normalized,
  })
  if (conflicts.length > 0) {
    throw new ApiError(
      'SCHEDULE_CHANGE_CONFLICT',
      'This schedule change would affect existing appointments. Resolve them before saving.',
      { affectedAppointments: conflicts },
    )
  }

  staff.intervals = normalized
  emit()
  return getMyAvailability()
}

export interface TimeOffInput {
  startAt: string
  endAt: string
  reason?: string
}

export async function addMyTimeOff(input: TimeOffInput): Promise<TimeOff> {
  const db = getDb()
  const staff = requireStaff(db)
  const start = Date.parse(input.startAt)
  const end = Date.parse(input.endAt)

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new ApiError('VALIDATION_ERROR', 'Choose a valid start and end time.')
  }

  const reason = input.reason?.trim() || undefined
  if (reason && reason.length > 200) {
    throw new ApiError('VALIDATION_ERROR', 'Keep the reason under 200 characters.')
  }

  const entry: TimeOff = {
    id: newId('tof'),
    staffId: staff.id,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    ...(reason ? { reason } : {}),
  }

  const conflicts = findScheduleConflicts(staffContext(db), staff, {
    timeOff: [...staff.timeOff, entry],
  })
  if (conflicts.length > 0) {
    throw new ApiError(
      'SCHEDULE_CHANGE_CONFLICT',
      'This time off would affect existing appointments. Resolve them first.',
      { affectedAppointments: conflicts },
    )
  }

  staff.timeOff.push(entry)
  emit()
  return entry
}

export async function removeMyTimeOff(id: string): Promise<void> {
  const db = getDb()
  const staff = requireStaff(db)
  const index = staff.timeOff.findIndex((entry) => entry.id === id)

  if (index === -1) {
    throw new ApiError('NOT_FOUND', 'That time-off entry is not available.')
  }

  staff.timeOff.splice(index, 1)
  emit()
}

/* ---------------- Helpers for the UI ---------------- */

export function nextGuestLinkPath(token: string): string {
  return `/cancel/${token}`
}

export function slotKey(slot: Slot): string {
  return slot.startAt
}
