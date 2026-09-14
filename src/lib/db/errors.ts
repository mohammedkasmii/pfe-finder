/**
 * Wraps a database failure with a fixed, bounded message. Never
 * interpolates the raw `cause` into `.message` — Postgres/Supabase error
 * objects can carry the failing row's data, so it's kept only as `.cause`
 * for local debugging, never surfaced to logs or ingestion_runs.error_summary.
 */
export class IngestionDbError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'IngestionDbError'
    this.cause = cause
  }
}
