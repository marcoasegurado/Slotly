import type {
  EmailEventType,
  NotificationPayload,
} from '../email/contract'
import { renderAppointmentEmail } from '../email/templates'
import {
  createEmailTransport,
  type EmailTransport,
} from '../email/transport'
import type { Env } from '../env'
import { unixSeconds } from '../lib/time'
import { BusinessSettingsRepository } from '../repositories/business-settings'
import {
  NotificationsRepository,
  type DeliveryRecord,
} from '../repositories/notifications'

/** Total attempts before a row is left failed for manual inspection. */
export const MAX_EMAIL_ATTEMPTS = 5
export const EMAIL_RETRY_BATCH = 25
/** An attempt this old is treated as abandoned by a crashed invocation. */
export const STALE_SENDING_SECONDS = 15 * 60

export interface NotificationTarget {
  appointmentId: string
  customerEmail: string | null
  guestEmail: string | null
}

/** Recipient for customer-facing appointment email. */
export function appointmentRecipient(
  target: Pick<NotificationTarget, 'customerEmail' | 'guestEmail'>,
): string | null {
  const email = target.customerEmail ?? target.guestEmail
  return email?.trim() || null
}

/**
 * Prepared outbox insert. Transition handlers add it to the same batch as the
 * conditional status change, token cleanup and audit row.
 */
export function buildNotificationStatement(
  db: D1Database,
  target: NotificationTarget,
  eventType: EmailEventType,
  payload: NotificationPayload,
  now: number,
  id?: string,
): D1PreparedStatement | null {
  const recipient = appointmentRecipient(target)
  if (!recipient) return null

  return new NotificationsRepository(db).statement({
    id,
    appointmentId: target.appointmentId,
    eventType,
    recipientEmail: recipient,
    payload,
    now,
  })
}

function sanitizeError(error: unknown): string {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Email delivery failed.'
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300)
}

async function sendRecord(
  env: Env,
  record: DeliveryRecord,
  transport: EmailTransport,
): Promise<void> {
  const business = await new BusinessSettingsRepository(env.DB).getPublic()
  const message = renderAppointmentEmail({
    eventType: record.eventType,
    businessName: business?.businessName ?? 'Slotly',
    businessEmail: business?.businessEmail ?? null,
    timezone: business?.timezone ?? 'UTC',
    publicReference: record.publicReference,
    serviceName: record.serviceName,
    durationMinutes: record.durationMinutes,
    startAt: record.startAt,
    endAt: record.endAt,
    recipientName: record.customerName ?? record.guestName ?? 'there',
    customerNote: record.customerNote,
    resolutionNote: record.payload.resolutionNote ?? record.resolutionNote,
    payload: record.payload,
  })

  await transport.send({
    to: record.recipientEmail,
    from: env.EMAIL_FROM?.trim() || 'Slotly <hello@slotly.studio>',
    replyTo: business?.businessEmail ?? env.EMAIL_REPLY_TO?.trim(),
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
}

/**
 * Claims and attempts one outbox row. Returns whether the email was sent. A
 * provider failure is recorded on the row and never throws to the caller, so a
 * valid booking or appointment change is never rolled back for email reasons.
 */
export async function attemptOutboxDelivery(
  env: Env,
  id: string,
  transport?: EmailTransport,
): Promise<boolean> {
  const repository = new NotificationsRepository(env.DB)
  const now = unixSeconds()
  const claimed = await repository.claim(
    id,
    now,
    MAX_EMAIL_ATTEMPTS,
    STALE_SENDING_SECONDS,
  )
  if (!claimed) return false

  try {
    const record = await repository.findForDelivery(id)
    if (!record) {
      await repository.markFailed(id, 'Notification record is missing.')
      return false
    }

    await sendRecord(
      env,
      record,
      transport ?? createEmailTransport(env),
    )

    const safePayload: NotificationPayload = { ...record.payload }
    delete safePayload.cancellationUrl
    await repository.markSent(id, unixSeconds(), safePayload)
    return true
  } catch (error) {
    await repository.markFailed(id, sanitizeError(error))
    return false
  }
}

/** Best-effort inline attempt after a booking or appointment change commits. */
export async function dispatchEmailById(env: Env, id: string): Promise<void> {
  try {
    await attemptOutboxDelivery(env, id)
  } catch {
    // The outbox retry job is the fallback; the API response stays successful.
  }
}

/**
 * Inline attempt for every undelivered email belonging to one appointment.
 * Covers the row just enqueued by the transition plus any earlier retryable one.
 */
export async function dispatchAppointmentEmails(
  env: Env,
  publicReference: string,
): Promise<void> {
  try {
    const repository = new NotificationsRepository(env.DB)
    const ids = await repository.listUndeliveredIdsForReference(
      publicReference,
      MAX_EMAIL_ATTEMPTS,
      10,
    )
    for (const id of ids) {
      await attemptOutboxDelivery(env, id)
    }
  } catch {
    // Scheduled delivery will pick the rows up later.
  }
}

export interface DeliverySummary {
  attempted: number
  sent: number
}

/** Scheduled/cron entry point for retryable and abandoned outbox rows. */
export async function deliverPendingEmails(
  env: Env,
  now: Date = new Date(),
  transport?: EmailTransport,
): Promise<DeliverySummary> {
  const repository = new NotificationsRepository(env.DB)
  const ids = await repository.listRetryableIds(
    unixSeconds(now.getTime()),
    MAX_EMAIL_ATTEMPTS,
    EMAIL_RETRY_BATCH,
    STALE_SENDING_SECONDS,
  )

  let sent = 0
  for (const id of ids) {
    if (await attemptOutboxDelivery(env, id, transport)) sent += 1
  }
  return { attempted: ids.length, sent }
}
