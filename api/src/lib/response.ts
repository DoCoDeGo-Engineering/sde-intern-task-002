import type { Context } from 'hono'

type ApiStatus = 200 | 201 | 400 | 404 | 409 | 422

export function jsonError(c: Context<{ Bindings: Env }>, status: ApiStatus, message: string) {
  return c.json({ error: message }, status)
}
