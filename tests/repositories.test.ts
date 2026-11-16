import { describe, expect, it } from 'vitest'
import { BusinessSettingsRepository } from '../worker/repositories/business-settings'
import { ServicesRepository } from '../worker/repositories/services'
import { createTestDatabase } from './helpers/test-d1'

describe('BusinessSettingsRepository', () => {
  it('maps the singleton row to the public API shape', async () => {
    const database = createTestDatabase()

    const business = await new BusinessSettingsRepository(database.d1).getPublic()

    expect(business).toEqual({
      businessName: 'Slotly Studio',
      businessEmail: 'hello@slotly.studio',
      timezone: 'Asia/Manila',
      maxAdvanceBookingDays: 60,
    })
  })

  it('returns null before settings are configured', async () => {
    const database = createTestDatabase({ seed: false })

    const business = await new BusinessSettingsRepository(database.d1).getPublic()

    expect(business).toBeNull()
  })
})

describe('ServicesRepository', () => {
  it('returns only active services in a stable order', async () => {
    const database = createTestDatabase()

    const services = await new ServicesRepository(database.d1).listActive()

    expect(services.map((service) => service.id)).toEqual([
      'svc_extended',
      'svc_consult',
      'svc_standard',
    ])
    expect(services.every((service) => service.isActive)).toBe(true)
    expect(services.map((service) => service.durationMinutes)).toEqual([90, 60, 45])
  })

  it('maps nullable descriptions without inventing data', async () => {
    const database = createTestDatabase({ seed: false })
    database.raw
      .prepare(
        `INSERT INTO services (id, name, description, duration_minutes, is_active)
         VALUES (?, ?, NULL, ?, 1)`,
      )
      .run('svc_null_description', 'Quiet session', 30)

    const services = await new ServicesRepository(database.d1).listActive()

    expect(services).toEqual([
      {
        id: 'svc_null_description',
        name: 'Quiet session',
        description: null,
        durationMinutes: 30,
        isActive: true,
      },
    ])
  })
})
