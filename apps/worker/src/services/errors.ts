/** Business errors raised by use cases; routes translate them to HTTP (404 / 409). */
export class ServiceError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict',
    readonly reason?: string,
  ) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = 'ServiceError';
  }
}

/** Postgres unique violation (23505), whether raised by node-postgres or PGlite, wrapped or not. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
