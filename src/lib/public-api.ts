import type { Business, Service } from './types'

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

export type PublicDataStatus = 'loading' | 'ready' | 'error'

export interface PublicDataState {
  status: PublicDataStatus
  business: Business | null
  services: Service[]
  error: string | null
}

let state: PublicDataState = {
  status: 'loading',
  business: null,
  services: [],
  error: null,
}

const listeners = new Set<() => void>()

function publish(next: PublicDataState): void {
  state = next
  for (const listener of listeners) listener()
}

export function subscribePublicData(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPublicDataState(): PublicDataState {
  return state
}

export interface PublicDataLoadResult {
  business: boolean
  services: boolean
}

/**
 * Loads the business settings and active services every public page depends on.
 * There is no offline demo fallback: if the Worker cannot answer, the UI says so
 * instead of showing sample values that would hide a broken deployment.
 */
export async function hydratePublicData(): Promise<PublicDataLoadResult> {
  const [businessResult, servicesResult] = await Promise.allSettled([
    fetchPublicBusiness(),
    fetchPublicServices(),
  ])

  const business = businessResult.status === 'fulfilled' ? businessResult.value : null
  const services = servicesResult.status === 'fulfilled' ? servicesResult.value : []

  if (!business) {
    publish({
      status: 'error',
      business: null,
      services,
      error:
        businessResult.status === 'rejected'
          ? errorText(businessResult.reason)
          : 'The business settings could not be loaded.',
    })
    return { business: false, services: servicesResult.status === 'fulfilled' }
  }

  publish({
    status: 'ready',
    business,
    services,
    error: null,
  })

  return { business: true, services: servicesResult.status === 'fulfilled' }
}

function errorText(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return 'The business settings could not be loaded.'
}
