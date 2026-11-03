export type Home = { id: string; name: string }
export type Member = { id: string; homeId: string; name: string }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

type ErrorKind = 'network' | 'timeout' | 'http' | 'invalid'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly status: number | null = null,
  ) {
    super(message)
  }

  get mayHaveSucceeded() {
    return this.kind === 'network' || this.kind === 'timeout' || (this.status ?? 0) >= 500
  }
}

const TIMEOUT_MS = 10_000

type Guard<T> = (value: unknown) => value is T

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isHome(value: unknown): value is Home {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
}

function isMember(value: unknown): value is Member {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.homeId === 'string' &&
    typeof value.name === 'string'
  )
}

function isShare(value: unknown): value is Share {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.memberId === 'string' &&
    isCents(value.amountCents) &&
    (value.paidAt === null || typeof value.paidAt === 'string')
  )
}

function isBill(value: unknown): value is Bill {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.homeId === 'string' &&
    typeof value.title === 'string' &&
    isCents(value.totalCents) &&
    Array.isArray(value.shares) &&
    value.shares.every(isShare)
  )
}

function isBalance(value: unknown): value is Balance {
  return (
    isRecord(value) &&
    typeof value.memberId === 'string' &&
    typeof value.name === 'string' &&
    isCents(value.outstandingCents)
  )
}

function listOf<T>(key: string, guard: Guard<T>): Guard<Record<string, T[]>> {
  return (value): value is Record<string, T[]> => {
    if (!isRecord(value)) return false
    const list = value[key]
    return Array.isArray(list) && list.every(guard)
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function request<T>(path: string, guard: Guard<T>, options: RequestOptions = {}) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    if (timeout.aborted) throw new ApiError('The server is taking too long to answer.', 'timeout')
    throw new ApiError('Could not reach the server. Check your connection.', 'network')
  }

  const data: unknown = await response.json().catch(() => undefined)
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  if (!response.ok) {
    const message =
      isRecord(data) && typeof data.error === 'string'
        ? data.error
        : `The server answered with an error (${response.status}).`
    throw new ApiError(message, 'http', response.status)
  }
  if (!guard(data)) {
    throw new ApiError('The server sent a response the page does not understand.', 'invalid')
  }
  return data
}

export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong.'
}

export async function listHomes(signal?: AbortSignal) {
  const body = await request('/api/homes', listOf('homes', isHome), { signal })
  return body.homes ?? []
}

export function createHome(name: string) {
  return request('/api/homes', isHome, { method: 'POST', body: { name } })
}

export function addMember(homeId: string, name: string) {
  return request(`/api/homes/${encodeURIComponent(homeId)}/members`, isMember, {
    method: 'POST',
    body: { name },
  })
}

export async function listBills(homeId: string, signal?: AbortSignal) {
  const path = `/api/homes/${encodeURIComponent(homeId)}/bills`
  const body = await request(path, listOf('bills', isBill), { signal })
  return body.bills ?? []
}

export async function listBalances(homeId: string, signal?: AbortSignal) {
  const path = `/api/homes/${encodeURIComponent(homeId)}/balances`
  const body = await request(path, listOf('balances', isBalance), { signal })
  return body.balances ?? []
}

export function createBill(homeId: string, title: string, totalCents: number) {
  return request(`/api/homes/${encodeURIComponent(homeId)}/bills`, isBill, {
    method: 'POST',
    body: { title, totalCents },
  })
}

export function payShare(billId: string, shareId: string, idempotencyKey: string) {
  const path = `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`
  return request(path, isShare, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  })
}
