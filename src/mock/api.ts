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
import { getDayAvailability, validateSlot } from '../lib/availability'
import type { AvailabilityContext } from '../lib/availability'
import { todayDateKey } from '../lib/time'
import { emit, getDb } from './store'
import {
  newCancellationToken,
  newId,
  newPublicReference,
  type MockDatabase,
} from './seed'
import type {
  Appointment,
  Business,
  DayAvailability,
  Service,
  Slot,
} from './types'

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'SLOT_UNAVAILABLE'
  | 'BOOKING_CONFLICT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'

export class ApiError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

export interface SessionUser {
  id: string
  name: string
  email: string
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

function publicUser(db: MockDatabase): SessionUser | null {
  if (!db.sessionCustomerId) return null
  const customer = db.customers.find((entry) => entry.id === db.sessionCustomerId)
  if (!customer) return null
  return { id: customer.id, name: customer.name, email: customer.email }
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
    const session = publicUser(db)
    if (!session) {
      throw new ApiError('UNAUTHENTICATED', 'Sign in again to book this appointment.')
    }
    customerUserId = session.id
    guestName = session.name
    guestEmail = session.email
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
  const session = publicUser(db)
  if (!session) {
    throw new ApiError('UNAUTHENTICATED', 'Sign in to see your appointments.')
  }

  const mine = db.appointments
    .filter((appointment) => appointment.customerUserId === session.id)
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
  const session = publicUser(db)
  if (!session) {
    throw new ApiError('UNAUTHENTICATED', 'Sign in to cancel your appointment.')
  }

  const appointment = db.appointments.find((entry) => entry.id === appointmentId)
  if (!appointment || appointment.customerUserId !== session.id) {
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
  if (db.customers.some((customer) => customer.email === email)) {
    throw new ApiError('EMAIL_IN_USE', 'An account with that email already exists.')
  }

  const customer = { id: newId('cus'), name, email, password: input.password }
  db.customers.push(customer)
  db.sessionCustomerId = customer.id
  emit()
  return { id: customer.id, name: customer.name, email: customer.email }
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const db = getDb()
  const customer = db.customers.find(
    (entry) => entry.email === normalizeEmail(email) && entry.password === password,
  )
  if (!customer) {
    throw new ApiError('INVALID_CREDENTIALS', 'That email and password do not match.')
  }
  db.sessionCustomerId = customer.id
  emit()
  return { id: customer.id, name: customer.name, email: customer.email }
}

export async function loginWithDemoAccount(): Promise<SessionUser> {
  return login('maria@example.com', 'slotly-demo')
}

export async function logout(): Promise<void> {
  getDb().sessionCustomerId = null
  emit()
}

export async function getSession(): Promise<SessionUser | null> {
  return publicUser(getDb())
}

/* ---------------- Helpers for the UI ---------------- */

export function nextGuestLinkPath(token: string): string {
  return `/cancel/${token}`
}

export function slotKey(slot: Slot): string {
  return slot.startAt
}
