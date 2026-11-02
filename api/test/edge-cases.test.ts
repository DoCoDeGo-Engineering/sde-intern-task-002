import { describe, expect, it } from 'vitest'
import { type Bill, call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

async function firstShare(members: string[], totalCents: number) {
  const { homeId } = await createHome(members)
  const bill = await createBill(homeId, totalCents)
  const share = bill.body.shares[0]
  if (!share) throw new Error('bill has no shares')
  return { homeId, billId: bill.body.id, share }
}

describe('edge cases', () => {
  it('lets only one of two payments with different keys at the same time succeed', async () => {
    const { billId, share } = await firstShare(['Asha', 'Ben'], 1000)

    const results = await Promise.all([
      pay(billId, share.id, crypto.randomUUID()),
      pay(billId, share.id, crypto.randomUUID()),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })

  it('answers both of two payments with the same key at the same time with one result', async () => {
    const { billId, share } = await firstShare(['Asha', 'Ben'], 1000)
    const key = crypto.randomUUID()

    const [a, b] = await Promise.all([pay(billId, share.id, key), pay(billId, share.id, key)])

    expect([a.status, b.status]).toEqual([200, 200])
    expect(a.body).toEqual(b.body)
  })

  it('splits fewer cents than members, giving the first members one cent each', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const bill = await createBill(homeId, 2)

    expect(bill.body.shares.map((s) => s.amountCents)).toEqual([1, 1, 0])
  })

  it('rejects a share that belongs to another bill', async () => {
    const { share } = await firstShare(['Asha'], 100)
    const other = await firstShare(['Ben'], 100)

    const paid = await pay(other.billId, share.id, crypto.randomUUID())

    expect(paid.status).toBe(404)
  })

  it.each([
    ['a missing amount', { title: 'Rent' }],
    ['an amount too large to be exact', { title: 'Rent', totalCents: 2 ** 53 }],
    ['a blank title', { title: '  ', totalCents: 100 }],
  ])('rejects %s', async (_, body) => {
    const { homeId } = await createHome(['Asha'])

    const bill = await call('POST', `/api/homes/${homeId}/bills`, { body })

    expect(bill.status).toBe(422)
  })

  it('rejects a home without a name', async () => {
    const home = await call('POST', '/api/homes', { body: { name: '' } })

    expect(home.status).toBe(422)
    expect(home.body).toEqual({ error: expect.any(String) })
  })

  it('answers unknown routes with a JSON error', async () => {
    const response = await call('GET', '/api/nope')

    expect(response).toEqual({ status: 404, body: { error: expect.any(String) } })
  })

  it('lists the bills of a home with their shares', async () => {
    const { homeId, billId, share } = await firstShare(['Asha', 'Ben'], 1000)
    await pay(billId, share.id, crypto.randomUUID())

    const listed = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(listed.status).toBe(200)
    expect(listed.body.bills).toHaveLength(1)
    expect(listed.body.bills[0]?.shares.map((s) => s.paidAt === null)).toEqual([false, true])
  })
})
