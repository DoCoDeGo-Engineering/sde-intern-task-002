export type Home = { id: string; name: string }
export type Member = { id: string; name: string }
export type HomeDetails = Home & { members: Member[] }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

export class ApiError extends Error {
  status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
  }
}

const TIMEOUT_MS = 8000

type Options = {
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function request<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT_MS)
  options.signal?.addEventListener('abort', () => controller.abort())

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new ApiError('The server took too long to answer. Try again.', null)
    }
    if (options.signal?.aborted) {
      throw error
    }
    throw new ApiError('Could not reach the server. Check the connection and try again.', null)
  } finally {
    clearTimeout(timer)
  }

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `The server answered with status ${response.status}.`
    throw new ApiError(message, response.status)
  }

  if (data === null) {
    throw new ApiError('The server sent an answer that could not be read.', response.status)
  }

  return data as T
}

export function listHomes(signal?: AbortSignal) {
  return request<{ homes: Home[] }>('GET', '/api/homes', { signal }).then((data) => data.homes)
}

export function createHome(name: string) {
  return request<Home>('POST', '/api/homes', { body: { name } })
}

export function getHome(homeId: string, signal?: AbortSignal) {
  return request<HomeDetails>('GET', `/api/homes/${homeId}`, { signal })
}

export function addMember(homeId: string, name: string) {
  return request<Member>('POST', `/api/homes/${homeId}/members`, { body: { name } })
}

export function listBills(homeId: string, signal?: AbortSignal) {
  return request<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`, { signal }).then(
    (data) => data.bills,
  )
}

export function createBill(homeId: string, title: string, totalCents: number) {
  return request<Bill>('POST', `/api/homes/${homeId}/bills`, { body: { title, totalCents } })
}

export function listBalances(homeId: string, signal?: AbortSignal) {
  return request<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`, { signal }).then(
    (data) => data.balances,
  )
}

export function payShare(billId: string, shareId: string, idempotencyKey: string) {
  return request<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': idempotencyKey },
  })
}
