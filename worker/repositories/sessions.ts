import type { UserRecord } from './users'

interface SessionUserRow extends UserRecord {
  session_id: string
}

export interface ValidSession {
  sessionId: string
  user: UserRecord
}

export class SessionsRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: {
    id: string
    userId: string
    tokenHash: string
    expiresAt: number
    createdAt: number
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sessions (
           id, user_id, session_token_hash, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.userId, input.tokenHash, input.expiresAt, input.createdAt)
      .run()
  }

  async findValidByTokenHash(
    tokenHash: string,
    now: number,
  ): Promise<ValidSession | null> {
    const row = await this.db
      .prepare(
        `SELECT
           s.id AS session_id,
           u.id, u.name, u.email, u.password_hash, u.role, u.is_active,
           u.must_change_password, u.temporary_password_expires_at,
           u.password_changed_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.session_token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
          AND u.is_active = 1`,
      )
      .bind(tokenHash, now)
      .first<SessionUserRow>()

    if (!row) return null

    const { session_id, ...user } = row
    return { sessionId: session_id, user }
  }

  async revokeByTokenHash(tokenHash: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE sessions
            SET revoked_at = ?
          WHERE session_token_hash = ? AND revoked_at IS NULL`,
      )
      .bind(now, tokenHash)
      .run()
  }

  async revokeAllForUserExcept(
    userId: string,
    keepSessionId: string,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE sessions
            SET revoked_at = ?
          WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
      )
      .bind(now, userId, keepSessionId)
      .run()
  }

  async revokeAllForUser(userId: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE sessions
            SET revoked_at = ?
          WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, userId)
      .run()
  }
}
