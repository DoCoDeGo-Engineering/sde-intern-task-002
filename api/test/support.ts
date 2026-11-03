import { env, exports } from 'cloudflare:workers'
import { call, type Share } from './helpers'

export async function rawPost(path: string, body: string, contentType = 'application/json') {
  const response = await exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }),
  )
  const text = await response.text()
  return { status: response.status, contentType: response.headers.get('content-type'), text }
}

export function pay(billId: string, shareId: string, key?: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: key === undefined ? {} : { 'Idempotency-Key': key },
  })
}

export async function outstanding(homeId: string) {
  const response = await call<{ balances: { outstandingCents: number }[] }>(
    'GET',
    `/api/homes/${homeId}/balances`,
  )
  return response.body.balances.map((balance) => balance.outstandingCents)
}

export async function countRows(table: 'homes' | 'members' | 'bills' | 'shares') {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()
  return row?.n ?? 0
}

export async function storedShare(shareId: string) {
  return env.DB.prepare('SELECT paid_at, idempotency_key FROM shares WHERE id = ?')
    .bind(shareId)
    .first<{ paid_at: string | null; idempotency_key: string | null }>()
}
