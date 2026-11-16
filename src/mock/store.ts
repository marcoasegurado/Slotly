import { createSeedDatabase, type MockDatabase } from './seed'

let database: MockDatabase = createSeedDatabase()

const listeners = new Set<() => void>()

export function getDb(): MockDatabase {
  return database
}

export function resetDb(): void {
  database = createSeedDatabase()
  emit()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emit(): void {
  // Publish a new top-level snapshot so useSyncExternalStore subscribers
  // re-render after in-place mutations.
  database = { ...database }
  for (const listener of listeners) listener()
}
