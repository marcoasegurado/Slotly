import { createSeedDatabase, type MockDatabase } from './seed'
import type { Business, Service } from './types'

let database: MockDatabase = createSeedDatabase()

const listeners = new Set<() => void>()

export function getDb(): MockDatabase {
  return database
}

export function resetDb(): void {
  database = createSeedDatabase()
  publish()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emit(): void {
  database = { ...database }
  publish()
}

/** Replaces only the public business settings with Worker-backed values. */
export function applyPublicBusiness(business: Business): void {
  database = { ...database, business }
  publish()
}

/** Replaces only the public service catalogue with Worker-backed values. */
export function applyPublicServices(services: Service[]): void {
  database = { ...database, services }
  publish()
}

function publish(): void {
  for (const listener of listeners) listener()
}
