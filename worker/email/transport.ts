import type { EmailMessage } from './contract'

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>
}

/**
 * Local development transport. It prints the email instead of contacting a
 * provider, which keeps `wrangler dev` usable without an API key.
 */
export class ConsoleEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<void> {
    console.info(
      `[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
    )
  }
}

/**
 * Test transport. No message leaves the process; the outbox row is treated as
 * delivered so API tests stay deterministic.
 */
export class NoopEmailTransport implements EmailTransport {
  async send(): Promise<void> {}
}

export class ResendEmailTransport implements EmailTransport {
  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    })

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      throw new Error(
        `Resend rejected the email with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      )
    }
  }
}

export interface EmailTransportEnv {
  ENVIRONMENT?: string
  EMAIL_TRANSPORT?: string
  RESEND_API_KEY?: string
}

/**
 * Selection order: explicit `EMAIL_TRANSPORT`, then a configured Resend key,
 * then the test no-op or the local console transport.
 */
export function createEmailTransport(env: EmailTransportEnv): EmailTransport {
  const mode = env.EMAIL_TRANSPORT?.trim().toLowerCase()

  if (mode === 'none') return new NoopEmailTransport()
  if (mode === 'console') return new ConsoleEmailTransport()
  if (mode === 'resend') {
    if (!env.RESEND_API_KEY?.trim()) {
      throw new Error(
        'EMAIL_TRANSPORT is "resend" but RESEND_API_KEY is not configured.',
      )
    }
    return new ResendEmailTransport(env.RESEND_API_KEY.trim())
  }

  if (env.RESEND_API_KEY?.trim()) {
    return new ResendEmailTransport(env.RESEND_API_KEY.trim())
  }
  if (env.ENVIRONMENT === 'test') return new NoopEmailTransport()
  return new ConsoleEmailTransport()
}
