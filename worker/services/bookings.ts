import { ApiError } from '../http/errors'
import {
  randomHex,
  randomId,
  randomPublicReference,
  sha256Hex,
} from '../lib/encoding'
import { toDateKey, unixSeconds } from '../lib/time'
import {
  BookingsRepository,
  type NewGuestToken,
} from '../repositories/bookings'
import { BusinessSettingsRepository } from '../repositories/business-settings'
import { ServicesRepository } from '../repositories/services'
import type { Booking, CreateBookingResult, CustomerBookings } from '../types'
import { getDayAvailability } from './availability'
import { loadAvailabilityContext } from './availability-context'
import { buildNotificationStatement } from './notifications'

/** Private guest links stop working after three days or at the appointment. */
export const GUEST_TOKEN_TTL_SECONDS = 72 * 60 * 60

export interface CreateBookingInput {
  serviceId: string
  /** Unix seconds. */
  startAt: number
  customerUserId: string | null
  customerEmail: string | null
  guestName: string | null
  guestEmail: string | null
  customerNote: string | null
  /** Origin used to build the guest cancellation link in the email. */
  requestOrigin: string
}

export interface CreateBookingOutcome {
  /** Public booking payload returned to the client. */
  result: CreateBookingResult
  /** Internal outbox row for the inline send attempt; never returned to clients. */
  notificationId: string | null
}

function cancellationUnavailable(): ApiError {
  return new ApiError(
    404,
    'CANCELLATION_LINK_UNAVAILABLE',
    'This cancellation link is no longer available.',
  )
}

function normalizeReference(reference: string): string {
  return reference.trim().toUpperCase()
}

/**
 * Creates a pending request. The client supplies only a service and start time;
 * the server rechecks a freshly loaded availability day, calculates the end
 * time and chooses an eligible staff member.
 */
export async function createBooking(
  db: D1Database,
  input: CreateBookingInput,
  now: Date = new Date(),
): Promise<CreateBookingOutcome> {
  const business = await new BusinessSettingsRepository(db).getPublic()
  if (!business) {
    throw new ApiError(
      404,
      'BUSINESS_NOT_CONFIGURED',
      'Business settings have not been configured.',
    )
  }

  const service = await new ServicesRepository(db).findActiveById(input.serviceId)
  if (!service) {
    throw new ApiError(
      404,
      'SERVICE_NOT_FOUND',
      'That service is not currently bookable.',
    )
  }

  const nowUnix = unixSeconds(now.getTime())
  if (input.startAt <= nowUnix) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Choose a time in the future.',
    )
  }

  const dateKey = toDateKey(new Date(input.startAt * 1000), business.timezone)
  const context = await loadAvailabilityContext(db, {
    timezone: business.timezone,
    maxAdvanceBookingDays: business.maxAdvanceBookingDays,
    dateKey,
  })
  const availability = getDayAvailability(
    context,
    service.durationMinutes,
    dateKey,
    now,
  )

  if (availability.state === 'outside-booking-window') {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Choose a time within the booking window.',
    )
  }
  if (availability.state !== 'open') {
    throw new ApiError(
      409,
      'BOOKING_CONFLICT',
      'That time is no longer available. Choose another time.',
    )
  }

  const slot = availability.slots.find(
    (candidate) => candidate.startAt === input.startAt,
  )
  if (!slot) {
    throw new ApiError(
      409,
      'BOOKING_CONFLICT',
      'That time is no longer available. Choose another time.',
    )
  }

  const id = randomId('apt')
  const publicReference = randomPublicReference()
  const createdAt = nowUnix
  const isGuest = input.customerUserId === null

  let cancellationToken: string | null = null
  let token: NewGuestToken | null = null
  if (isGuest) {
    cancellationToken = randomHex(32)
    token = {
      id: randomId('gct'),
      appointmentId: id,
      tokenHash: await sha256Hex(cancellationToken),
      expiresAt: Math.min(
        input.startAt,
        createdAt + GUEST_TOKEN_TTL_SECONDS,
      ),
      now: createdAt,
    }
  }

  const booking: Booking = {
    publicReference,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    startAt: input.startAt,
    endAt: slot.endAt,
    status: 'pending',
    customerNote: input.customerNote,
    guestName: isGuest ? input.guestName : null,
    guestEmail: isGuest ? input.guestEmail : null,
    createdAt,
    updatedAt: createdAt,
  }

  const recipientEmail = isGuest ? input.guestEmail : input.customerEmail
  const cancellationUrl = cancellationToken
    ? `${input.requestOrigin.replace(/\/+$/, '')}/cancel/${encodeURIComponent(
        cancellationToken,
      )}`
    : null

  let notificationId: string | null = null
  let notification: D1PreparedStatement | null = null
  if (recipientEmail) {
    notificationId = randomId('ntf')
    notification = buildNotificationStatement(
      db,
      {
        appointmentId: id,
        customerEmail: input.customerEmail,
        guestEmail: input.guestEmail,
      },
      'request_received',
      cancellationUrl ? { cancellationUrl } : {},
      createdAt,
      notificationId,
    )
  }

  await new BookingsRepository(db).create(
    {
      id,
      publicReference,
      customerUserId: input.customerUserId,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      serviceId: service.id,
      serviceName: service.name,
      durationMinutes: service.durationMinutes,
      assignedStaffUserId: slot.staffId,
      startAt: input.startAt,
      endAt: slot.endAt,
      customerNote: input.customerNote,
      now: createdAt,
    },
    token,
    notification,
  )

  return {
    result: { appointment: booking, cancellationToken },
    notificationId,
  }
}

export async function listCustomerBookings(
  db: D1Database,
  customerUserId: string,
  now: Date = new Date(),
): Promise<CustomerBookings> {
  const nowUnix = unixSeconds(now.getTime())
  const bookings = await new BookingsRepository(db).listForCustomer(
    customerUserId,
  )

  const isUpcoming = (booking: Booking) =>
    booking.status === 'pending' ||
    (booking.status === 'confirmed' && booking.endAt > nowUnix)

  return {
    // The repository returns ascending starts; the UI lists newest first.
    upcoming: bookings.filter(isUpcoming).reverse(),
    past: bookings.filter((booking) => !isUpcoming(booking)).reverse(),
  }
}

export async function getCustomerBooking(
  db: D1Database,
  customerUserId: string,
  reference: string,
): Promise<Booking> {
  const booking = await new BookingsRepository(db).findForCustomer(
    customerUserId,
    normalizeReference(reference),
  )
  if (!booking) {
    throw new ApiError(404, 'BOOKING_NOT_FOUND', 'That booking was not found.')
  }
  return booking
}

export async function cancelCustomerBooking(
  db: D1Database,
  customerUserId: string,
  reference: string,
  now: Date = new Date(),
): Promise<Booking> {
  const repository = new BookingsRepository(db)
  const publicReference = normalizeReference(reference)
  const existing = await repository.findForCustomer(
    customerUserId,
    publicReference,
  )

  if (!existing) {
    throw new ApiError(404, 'BOOKING_NOT_FOUND', 'That booking was not found.')
  }
  if (existing.status !== 'pending') {
    throw new ApiError(
      409,
      'BOOKING_CONFLICT',
      'Only a pending request can be cancelled. Contact the business to change a confirmed appointment.',
    )
  }

  const cancelled = await repository.cancelPendingForCustomer(
    customerUserId,
    publicReference,
    unixSeconds(now.getTime()),
  )
  if (!cancelled) {
    throw new ApiError(
      409,
      'BOOKING_CONFLICT',
      'This request has already changed. Refresh and try again.',
    )
  }

  return await getCustomerBooking(db, customerUserId, publicReference)
}

export async function cancelGuestBooking(
  db: D1Database,
  token: string,
  now: Date = new Date(),
): Promise<{ publicReference: string }> {
  const repository = new BookingsRepository(db)
  const nowUnix = unixSeconds(now.getTime())
  const lookup = await repository.findGuestToken(
    await sha256Hex(token),
    nowUnix,
  )
  if (!lookup) throw cancellationUnavailable()

  const cancelled = await repository.cancelPendingGuest(
    lookup.tokenId,
    lookup.appointmentId,
    nowUnix,
  )
  if (!cancelled) throw cancellationUnavailable()

  await repository.markGuestTokenUsed(lookup.tokenId, nowUnix)
  return { publicReference: lookup.publicReference }
}
