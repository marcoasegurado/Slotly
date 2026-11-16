import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { D1Database, D1Result } from '@cloudflare/workers-types'

const repoRoot = process.cwd()

export const migrationSql = readFileSync(
  resolve(repoRoot, 'migrations', '0001_initial_schema.sql'),
  'utf8',
)

export const seedSql = readFileSync(
  resolve(repoRoot, 'seed', 'local.sql'),
  'utf8',
)

/**
 * Minimal D1-compatible adapter over node:sqlite. It implements only the API
 * surface used by Slotly repositories and routes: prepare/bind/first/all/run,
 * batch and exec. Tests must use this instead of a remote D1 database.
 */
class TestStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): TestStatement {
    return new TestStatement(this.database, this.sql, values as SQLInputValue[])
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.values) as
      | Record<string, unknown>
      | undefined

    if (!row) return null
    if (columnName !== undefined) return (row[columnName] as T | undefined) ?? null
    return row as T
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.database.prepare(this.sql).all(...this.values) as T[]
    return { success: true, results, meta: {} } as D1Result<T>
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = this.database.prepare(this.sql).run(...this.values)
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    } as unknown as D1Result<T>
  }
}

export class TestDatabase {
  readonly raw: DatabaseSync

  constructor() {
    this.raw = new DatabaseSync(':memory:')
    this.raw.exec('PRAGMA foreign_keys = ON')
  }

  migrate(): this {
    this.raw.exec(migrationSql)
    return this
  }

  seed(): this {
    this.raw.exec(seedSql)
    return this
  }

  /** The same object is exposed as a D1 binding to Hono and repositories. */
  get d1(): D1Database {
    return this as unknown as D1Database
  }

  prepare(query: string): TestStatement {
    return new TestStatement(this.raw, query)
  }

  async batch<T = unknown>(statements: TestStatement[]): Promise<D1Result<T>[]> {
    this.raw.exec('BEGIN')
    try {
      const results: D1Result<T>[] = []
      for (const statement of statements) {
        results.push(await statement.run<T>())
      }
      this.raw.exec('COMMIT')
      return results
    } catch (error) {
      this.raw.exec('ROLLBACK')
      throw error
    }
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    this.raw.exec(query)
    return { count: 0, duration: 0 }
  }
}

export function createTestDatabase(options: { seed?: boolean } = {}): TestDatabase {
  const database = new TestDatabase().migrate()
  if (options.seed !== false) database.seed()
  return database
}
