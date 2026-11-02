import { useActionState } from 'react'

export type Home = { id: string; name: string }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

type Options = { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> }

// Every failure (network, timeout, error status, broken body) becomes an Error with a readable message.
export async function api<T>(path: string, { method = 'GET', body, headers }: Options = {}) {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new Error(
      error instanceof DOMException && error.name === 'TimeoutError'
        ? 'The server took too long to answer. Try again.'
        : 'Could not reach the server. Check your connection and try again.',
    )
  }
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok || data === null) {
    throw new Error(
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status}).`,
    )
  }
  return data as T
}

export const money = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

// A form action that turns a thrown error into a message: returns [error, action, pending].
export function useFormAction(run: (form: FormData) => Promise<void>) {
  return useActionState<string | null, FormData>(async (_, form) => {
    try {
      await run(form)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Something went wrong.'
    }
  }, null)
}
