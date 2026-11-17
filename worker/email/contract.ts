/** Exactly the three customer-facing transactional email types in the MVP. */
export type EmailEventType =
  | 'request_received'
  | 'booking_confirmed'
  | 'booking_update'

/** Why a `booking_update` email was sent. */
export type BookingUpdateAction =
  | 'rejected'
  | 'cancelled'
  | 'rescheduled'
  | 'reassigned'

/**
 * Minimum safe outbox payload. The guest cancellation URL is the only secret;
 * it is removed from the stored payload once the email has been sent.
 */
export interface NotificationPayload {
  cancellationUrl?: string
  action?: BookingUpdateAction
  /** Unix seconds. */
  previousStartAt?: number
  /** Unix seconds. */
  previousEndAt?: number
  resolutionNote?: string | null
}

export interface EmailMessage {
  to: string
  from: string
  replyTo?: string
  subject: string
  text: string
  html: string
}
