import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export function fail(status: ContentfulStatusCode, message: string): never {
  throw new HTTPException(status, { message })
}

export async function readObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return fail(400, 'Body must be valid JSON')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object')
  }

  return body as Record<string, unknown>
}

export function readText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    return fail(422, `${field} must be a string`)
  }

  const text = value.trim()
  if (text.length === 0 || text.length > 100) {
    return fail(422, `${field} must have between 1 and 100 characters`)
  }

  return text
}

/*
  Number.isSafeInteger is false for 10.5 and for numbers too big to be exact,
  and it is also false for strings and null, so one check covers all of them.
*/
export function readCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return fail(422, 'totalCents must be a whole number of cents, more than 0')
  }

  return value
}
