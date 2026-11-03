import { HTTPException } from 'hono/http-exception'

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON' })
  }
  if (!isJsonObject(body)) {
    throw new HTTPException(400, { message: 'Request body must be a JSON object' })
  }
  return body
}

export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HTTPException(422, { message: `${field} must be a non-empty string` })
  }
  return value.trim()
}

export function requirePositiveCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HTTPException(422, { message: `${field} must be a positive whole number of cents` })
  }
  return value
}
