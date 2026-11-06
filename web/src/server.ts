export type HomeSummary = { id: string; name: string }
export type Person = { id: string; name: string }
export type HomeFull = HomeSummary & { members: Person[] }
export type ShareLine = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type BillData = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: ShareLine[]
}
export type Owed = { memberId: string; name: string; outstandingCents: number }

export class ServerError extends Error {
  httpCode: number | null

  constructor(sentence: string, httpCode: number | null) {
    super(sentence)
    this.httpCode = httpCode
  }
}

const GIVE_UP_AFTER_MS = 8000

type Settings = {
  sendBody?: unknown
  extraHeaders?: Record<string, string>
  cancelWith?: AbortSignal
}

async function callServer<Result>(
  verb: string,
  url: string,
  settings: Settings = {},
): Promise<Result> {
  const stopper = new AbortController()
  let tookTooLong = false

  const timer = setTimeout(() => {
    tookTooLong = true
    stopper.abort()
  }, GIVE_UP_AFTER_MS)
  settings.cancelWith?.addEventListener('abort', () => stopper.abort())

  let reply: Response
  try {
    reply = await fetch(url, {
      method: verb,
      headers: { 'Content-Type': 'application/json', ...settings.extraHeaders },
      body: settings.sendBody === undefined ? undefined : JSON.stringify(settings.sendBody),
      signal: stopper.signal,
    })
  } catch (problem) {
    if (tookTooLong) {
      throw new ServerError('The server took too long to answer. Try again.', null)
    }
    if (settings.cancelWith?.aborted) {
      throw problem
    }
    throw new ServerError('Could not reach the server. Check the connection and try again.', null)
  } finally {
    clearTimeout(timer)
  }

  let parsed: unknown = null
  try {
    parsed = await reply.json()
  } catch {
    parsed = null
  }

  if (!reply.ok) {
    const sentence =
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof parsed.error === 'string'
        ? parsed.error
        : `The server answered with status ${reply.status}.`
    throw new ServerError(sentence, reply.status)
  }

  if (parsed === null) {
    throw new ServerError('The server sent an answer that could not be read.', reply.status)
  }

  return parsed as Result
}

export function loadHomes(cancelWith?: AbortSignal) {
  return callServer<{ homes: HomeSummary[] }>('GET', '/api/homes', { cancelWith }).then(
    (answer) => answer.homes,
  )
}

export function postHome(name: string) {
  return callServer<HomeSummary>('POST', '/api/homes', { sendBody: { name } })
}

export function loadHome(homeId: string, cancelWith?: AbortSignal) {
  return callServer<HomeFull>('GET', `/api/homes/${homeId}`, { cancelWith })
}

export function postMember(homeId: string, name: string) {
  return callServer<Person>('POST', `/api/homes/${homeId}/members`, { sendBody: { name } })
}

export function loadBills(homeId: string, cancelWith?: AbortSignal) {
  return callServer<{ bills: BillData[] }>('GET', `/api/homes/${homeId}/bills`, {
    cancelWith,
  }).then((answer) => answer.bills)
}

export function submitBill(homeId: string, title: string, totalCents: number) {
  return callServer<BillData>('POST', `/api/homes/${homeId}/bills`, {
    sendBody: { title, totalCents },
  })
}

export function loadOwed(homeId: string, cancelWith?: AbortSignal) {
  return callServer<{ balances: Owed[] }>('GET', `/api/homes/${homeId}/balances`, {
    cancelWith,
  }).then((answer) => answer.balances)
}

export function postPayment(billId: string, shareId: string, idemKey: string) {
  return callServer<ShareLine>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    extraHeaders: { 'Idempotency-Key': idemKey },
  })
}
