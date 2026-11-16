import type { AppointmentStatus, PublicService } from '../types'

interface ServiceRow {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  is_active: number
}

interface FutureBookingRow {
  public_reference: string
  status: AppointmentStatus
  start_at: number
}

export interface FutureServiceBooking {
  publicReference: string
  status: AppointmentStatus
  /** Unix seconds. */
  startAt: number
}

export interface CreateServiceInput {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  isActive: boolean
  now: number
}

export interface UpdateServiceInput {
  name?: string
  description?: string | null
  durationMinutes?: number
  isActive?: boolean
}

function toPublicService(row: ServiceRow): PublicService {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    isActive: row.is_active === 1,
  }
}

export class ServicesRepository {
  constructor(private readonly db: D1Database) {}

  /** Active services only; inactive services must not appear publicly. */
  async listActive(): Promise<PublicService[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, name, description, duration_minutes, is_active
           FROM services
          WHERE is_active = 1
          ORDER BY name COLLATE NOCASE ASC, id ASC`,
      )
      .all<ServiceRow>()

    return results.map(toPublicService)
  }

  async listAll(): Promise<PublicService[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, name, description, duration_minutes, is_active
           FROM services
          ORDER BY name COLLATE NOCASE ASC, id ASC`,
      )
      .all<ServiceRow>()

    return results.map(toPublicService)
  }

  async findById(id: string): Promise<PublicService | null> {
    const row = await this.db
      .prepare(
        `SELECT id, name, description, duration_minutes, is_active
           FROM services
          WHERE id = ?`,
      )
      .bind(id)
      .first<ServiceRow>()

    return row ? toPublicService(row) : null
  }

  async findActiveById(id: string): Promise<PublicService | null> {
    const row = await this.db
      .prepare(
        `SELECT id, name, description, duration_minutes, is_active
           FROM services
          WHERE id = ? AND is_active = 1`,
      )
      .bind(id)
      .first<ServiceRow>()

    return row ? toPublicService(row) : null
  }

  async create(input: CreateServiceInput): Promise<PublicService> {
    await this.db
      .prepare(
        `INSERT INTO services (
           id, name, description, duration_minutes, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.name,
        input.description,
        input.durationMinutes,
        input.isActive ? 1 : 0,
        input.now,
        input.now,
      )
      .run()

    const service = await this.findById(input.id)
    if (!service) throw new Error('Created service could not be read back.')
    return service
  }

  async update(
    id: string,
    input: UpdateServiceInput,
    now: number,
  ): Promise<PublicService | null> {
    const assignments: string[] = []
    const values: unknown[] = []

    if (input.name !== undefined) {
      assignments.push('name = ?')
      values.push(input.name)
    }
    if (input.description !== undefined) {
      assignments.push('description = ?')
      values.push(input.description)
    }
    if (input.durationMinutes !== undefined) {
      assignments.push('duration_minutes = ?')
      values.push(input.durationMinutes)
    }
    if (input.isActive !== undefined) {
      assignments.push('is_active = ?')
      values.push(input.isActive ? 1 : 0)
    }

    if (assignments.length === 0) {
      return this.findById(id)
    }

    assignments.push('updated_at = ?')
    values.push(now, id)

    await this.db
      .prepare(`UPDATE services SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run()

    return this.findById(id)
  }

  async listFutureBookings(
    serviceId: string,
    now: number,
  ): Promise<FutureServiceBooking[]> {
    const { results } = await this.db
      .prepare(
        `SELECT public_reference, status, start_at
           FROM appointments
          WHERE service_id = ?
            AND status IN ('pending', 'confirmed')
            AND start_at > ?
          ORDER BY start_at ASC, id ASC`,
      )
      .bind(serviceId, now)
      .all<FutureBookingRow>()

    return results.map((row) => ({
      publicReference: row.public_reference,
      status: row.status,
      startAt: row.start_at,
    }))
  }
}
