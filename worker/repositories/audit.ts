import { randomId } from '../lib/encoding'

export interface AuditEntryInput {
  actorUserId: string
  action: string
  entityType: string
  entityId: string
  metadata: Record<string, unknown>
  now: number
}

export class AuditRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Returns the insert as a prepared statement so callers can batch it with the
   * token invalidation that follows a successful appointment transition.
   */
  statement(input: AuditEntryInput): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO audit_logs (
           id, actor_user_id, action, entity_type, entity_id,
           metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        randomId('aud'),
        input.actorUserId,
        input.action,
        input.entityType,
        input.entityId,
        JSON.stringify(input.metadata),
        input.now,
      )
  }

  async record(input: AuditEntryInput): Promise<void> {
    await this.statement(input).run()
  }
}
