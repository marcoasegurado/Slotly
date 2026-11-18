import type { UserRole } from '../types'

export interface UserRecord {
  id: string
  name: string
  email: string
  password_hash: string
  role: UserRole
  is_active: number
  must_change_password: number
  temporary_password_expires_at: number | null
  password_changed_at: number | null
}

const USER_COLUMNS = `
  id, name, email, password_hash, role, is_active, must_change_password,
  temporary_password_expires_at, password_changed_at
`

export class UsersRepository {
  constructor(private readonly db: D1Database) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
      .bind(email)
      .first<UserRecord>()
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
      .bind(id)
      .first<UserRecord>()
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users
            SET password_hash = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(passwordHash, now, userId)
      .run()
  }

  async createCustomer(input: {
    id: string
    name: string
    email: string
    passwordHash: string
    now: number
  }): Promise<UserRecord> {
    await this.db
      .prepare(
        `INSERT INTO users (
           id, name, email, password_hash, role, is_active,
           must_change_password, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'customer', 1, 0, ?, ?)`,
      )
      .bind(
        input.id,
        input.name,
        input.email,
        input.passwordHash,
        input.now,
        input.now,
      )
      .run()

    const user = await this.findById(input.id)
    if (!user) throw new Error('Created customer could not be read back.')
    return user
  }

  async completePasswordChange(
    userId: string,
    passwordHash: string,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users
            SET password_hash = ?,
                must_change_password = 0,
                temporary_password_expires_at = NULL,
                password_changed_at = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(passwordHash, now, now, userId)
      .run()
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed/i.test(error.message)
  )
}
