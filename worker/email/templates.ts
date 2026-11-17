import type {
  BookingUpdateAction,
  EmailEventType,
  NotificationPayload,
} from './contract'

export interface AppointmentEmailInput {
  eventType: EmailEventType
  businessName: string
  businessEmail: string | null
  timezone: string
  publicReference: string
  serviceName: string
  durationMinutes: number
  /** Unix seconds. */
  startAt: number
  /** Unix seconds. */
  endAt: number
  recipientName: string
  customerNote: string | null
  resolutionNote: string | null
  payload: NotificationPayload
}

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  )
}

function greetingName(name: string): string {
  const trimmed = name.trim()
  return trimmed === '' ? 'there' : trimmed
}

function formatDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(instant)
}

function formatTime(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(instant)
}

export function formatAppointmentRange(
  startAt: number,
  endAt: number,
  timezone: string,
): string {
  const start = new Date(startAt * 1000)
  const end = new Date(endAt * 1000)
  const startDate = formatDate(start, timezone)
  const startTime = formatTime(start, timezone)
  const endDate = formatDate(end, timezone)
  const endTime = formatTime(end, timezone)

  return startDate === endDate
    ? `${startDate}, ${startTime} – ${endTime}`
    : `${startDate}, ${startTime} – ${endDate}, ${endTime}`
}

function updateCopy(action: BookingUpdateAction | undefined): {
  subject: string
  intro: string
  previousLabel: string | null
} {
  if (action === 'rejected') {
    return {
      subject: 'Update on your request',
      intro:
        'Unfortunately, we could not accommodate this request. No appointment has been confirmed.',
      previousLabel: null,
    }
  }
  if (action === 'cancelled') {
    return {
      subject: 'Your appointment was cancelled',
      intro: 'This appointment has been cancelled.',
      previousLabel: null,
    }
  }
  return {
    subject: 'Your appointment was updated',
    intro: 'Your appointment details have been updated.',
    previousLabel: 'Previous time',
  }
}

export function renderAppointmentEmail(
  input: AppointmentEmailInput,
): RenderedEmail {
  const name = greetingName(input.recipientName)
  const when = formatAppointmentRange(
    input.startAt,
    input.endAt,
    input.timezone,
  )

  let subject: string
  let intro: string
  let previousLine: string | null = null
  let reasonLine: string | null = null

  if (input.eventType === 'request_received') {
    subject = `We received your request (${input.publicReference})`
    intro =
      'Thanks for your request. It is pending, and the team will review it shortly. This is not a confirmed appointment yet.'
  } else if (input.eventType === 'booking_confirmed') {
    subject = `Your appointment is confirmed (${input.publicReference})`
    intro =
      'Your appointment is confirmed. We look forward to seeing you.'
  } else {
    const copy = updateCopy(input.payload.action)
    subject = `${copy.subject} (${input.publicReference})`
    intro = copy.intro

    if (
      copy.previousLabel &&
      input.payload.previousStartAt !== undefined &&
      input.payload.previousEndAt !== undefined
    ) {
      previousLine = `${copy.previousLabel}: ${formatAppointmentRange(
        input.payload.previousStartAt,
        input.payload.previousEndAt,
        input.timezone,
      )}`
    }
    if (input.resolutionNote) {
      reasonLine = `Reason: ${input.resolutionNote}`
    }
  }

  const details = [
    `Service: ${input.serviceName} (${input.durationMinutes} minutes)`,
    `When: ${when}`,
    `Reference: ${input.publicReference}`,
  ]
  if (previousLine) details.push(previousLine)

  const footer = input.businessEmail
    ? `Questions? Reply to ${input.businessEmail}.`
    : ''

  const textLines = [
    `Hi ${name},`,
    '',
    intro,
    '',
    ...details,
    ...(reasonLine ? ['', reasonLine] : []),
    ...(input.customerNote ? ['', `Your note: ${input.customerNote}`] : []),
    ...(input.payload.cancellationUrl
      ? [
          '',
          'Changed your mind? Cancel this request:',
          input.payload.cancellationUrl,
        ]
      : []),
    '',
    `— ${input.businessName}`,
    ...(footer ? [footer] : []),
  ]

  const detailRows = details
    .map((line) => {
      const separator = line.indexOf(': ')
      const label = separator === -1 ? '' : line.slice(0, separator)
      const value = separator === -1 ? line : line.slice(separator + 2)
      return `<tr><td style="padding:2px 12px 2px 0;color:#52606d">${escapeHtml(
        label,
      )}</td><td style="padding:2px 0;color:#1f2933">${escapeHtml(
        value,
      )}</td></tr>`
    })
    .join('')

  const htmlParts = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<table role="presentation" style="border-collapse:collapse;margin:16px 0">${detailRows}</table>`,
  ]
  if (reasonLine) {
    htmlParts.push(`<p>${escapeHtml(reasonLine)}</p>`)
  }
  if (input.customerNote) {
    htmlParts.push(`<p>Your note: ${escapeHtml(input.customerNote)}</p>`)
  }
  if (input.payload.cancellationUrl) {
    htmlParts.push(
      `<p>Changed your mind? <a href="${escapeHtml(
        input.payload.cancellationUrl,
      )}">Cancel this request</a>.</p>`,
    )
  }
  htmlParts.push(`<p>— ${escapeHtml(input.businessName)}</p>`)
  if (footer) htmlParts.push(`<p>${escapeHtml(footer)}</p>`)

  return {
    subject,
    text: textLines.join('\n'),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:560px">${htmlParts.join(
      '',
    )}</div>`,
  }
}
