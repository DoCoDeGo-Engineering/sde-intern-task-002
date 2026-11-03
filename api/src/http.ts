import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type HomeEntry = { id: string; name: string }

export function reject(code: ContentfulStatusCode, reason: string): never {
  throw new HTTPException(code, { message: reason })
}

export async function parseBody(incoming: Request): Promise<Record<string, unknown>> {
  let payload: unknown

  try {
    payload = await incoming.json()
  } catch {
    return reject(400, 'The body is not valid JSON')
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return reject(400, 'Send a JSON object')
  }

  return payload as Record<string, unknown>
}

export function cleanName(raw: unknown, label: string): string {
  if (typeof raw !== 'string') {
    return reject(422, `${label} must be text`)
  }

  const trimmed = raw.trim()
  if (trimmed.length < 1 || trimmed.length > 100) {
    return reject(422, `${label} needs 1 to 100 characters`)
  }

  return trimmed
}

/*
  A string, null, 10.5 or a number too big to be exact is not a safe integer,
  so this one test refuses all of them.
*/
export function checkTotal(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) {
    return reject(422, 'totalCents must be a whole number above 0')
  }

  return raw
}

export async function homeOr404(database: D1Database, homeId: string): Promise<HomeEntry> {
  const found = await database
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeEntry>()

  return found ?? reject(404, 'No home with that id')
}
