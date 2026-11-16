import type { Business, Service } from '../mock/types'
import { applyPublicBusiness, applyPublicServices } from '../mock/store'

interface ApiErrorEnvelope {
  error?: {
    code?: unknown
    message?: unknown
  }
}

export class PublicApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PublicApiError'
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function requestData(path: string): Promise<unknown> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  })

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const error = isRecord(body) ? (body as ApiErrorEnvelope).error : undefined
    const code =
      isRecord(error) && typeof error.code === 'string'
        ? error.code
        : 'REQUEST_FAILED'
    const message =
      isRecord(error) && typeof error.message === 'string'
        ? error.message
        : 'The request could not be completed.'
    throw new PublicApiError(response.status, code, message)
  }

  if (!isRecord(body) || !('data' in body)) {
    throw new PublicApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an unexpected response.',
    )
  }

  return body.data
}

function parseBusiness(value: unknown): Business {
  if (
    !isRecord(value) ||
    typeof value.businessName !== 'string' ||
    (typeof value.businessEmail !== 'string' && value.businessEmail !== null) ||
    typeof value.timezone !== 'string' ||
    !Number.isInteger(value.maxAdvanceBookingDays)
  ) {
    throw new PublicApiError(
      200,
      'INVALID_RESPONSE',
      'The business settings response was not valid.',
    )
  }

  return {
    businessName: value.businessName,
    businessEmail: value.businessEmail,
    timezone: value.timezone,
    maxAdvanceBookingDays: value.maxAdvanceBookingDays as number,
  }
}

function parseService(value: unknown): Service {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    (typeof value.description !== 'string' && value.description !== null) ||
    !Number.isInteger(value.durationMinutes) ||
    typeof value.isActive !== 'boolean'
  ) {
    throw new PublicApiError(
      200,
      'INVALID_RESPONSE',
      'The services response was not valid.',
    )
  }

  return {
    id: value.id,
    name: value.name,
    description: value.description,
    durationMinutes: value.durationMinutes as number,
    isActive: value.isActive,
  }
}

export async function fetchPublicBusiness(): Promise<Business> {
  return parseBusiness(await requestData('/api/public/business'))
}

export async function fetchPublicServices(): Promise<Service[]> {
  const data = await requestData('/api/public/services')
  if (!Array.isArray(data)) {
    throw new PublicApiError(
      200,
      'INVALID_RESPONSE',
      'The services response was not valid.',
    )
  }
  return data.map(parseService)
}

export interface PublicDataLoadResult {
  business: boolean
  services: boolean
}

/**
 * Loads public configuration from the Worker and applies it to the local UI
 * store. Other booking operations are still mock-backed until the later API
 * phases. If the Worker is not running, the existing demo data stays visible
 * so the UI remains reviewable offline.
 */
export async function hydratePublicData(): Promise<PublicDataLoadResult> {
  const [businessResult, servicesResult] = await Promise.allSettled([
    fetchPublicBusiness(),
    fetchPublicServices(),
  ])

  if (businessResult.status === 'fulfilled') {
    applyPublicBusiness(businessResult.value)
  } else {
    console.warn(
      '[slotly] Public business settings could not be loaded; using demo values.',
      businessResult.reason,
    )
  }

  if (servicesResult.status === 'fulfilled') {
    applyPublicServices(servicesResult.value)
  } else {
    console.warn(
      '[slotly] Public services could not be loaded; using demo values.',
      servicesResult.reason,
    )
  }

  return {
    business: businessResult.status === 'fulfilled',
    services: servicesResult.status === 'fulfilled',
  }
}
