import type { PublicBusiness } from '../types'

interface BusinessSettingsRow {
  business_name: string
  business_email: string | null
  business_timezone: string
  max_advance_booking_days: number
}

export class BusinessSettingsRepository {
  constructor(private readonly db: D1Database) {}

  /** Returns the public singleton settings row, or null before setup. */
  async getPublic(): Promise<PublicBusiness | null> {
    const row = await this.db
      .prepare(
        `SELECT business_name, business_email, business_timezone, max_advance_booking_days
           FROM business_settings
          WHERE id = 1`,
      )
      .first<BusinessSettingsRow>()

    if (!row) return null

    return {
      businessName: row.business_name,
      businessEmail: row.business_email,
      timezone: row.business_timezone,
      maxAdvanceBookingDays: row.max_advance_booking_days,
    }
  }
}
