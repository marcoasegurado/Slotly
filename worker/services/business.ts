import { ApiError } from '../http/errors'
import { BusinessSettingsRepository } from '../repositories/business-settings'
import type { PublicBusiness } from '../types'

/**
 * Staff/admin endpoints need the business timezone and booking window. Missing
 * settings are a server configuration error rather than a public 404.
 */
export async function requireBusinessSettings(
  db: D1Database,
): Promise<PublicBusiness> {
  const business = await new BusinessSettingsRepository(db).getPublic()
  if (!business) {
    throw new ApiError(
      500,
      'BUSINESS_NOT_CONFIGURED',
      'Business settings have not been configured.',
    )
  }
  return business
}
