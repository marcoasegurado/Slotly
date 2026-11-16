import type { PublicService } from '../types'

interface ServiceRow {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  is_active: number
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

    return results.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      durationMinutes: row.duration_minutes,
      isActive: row.is_active === 1,
    }))
  }
}
