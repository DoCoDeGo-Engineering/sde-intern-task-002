import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Share } from './helpers'
import { outstanding, pay, storedShare } from './support'

async function setup(names = ['Asha', 'Ben', 'Chitra'], totalCents = 1000) {
  const { homeId, members } = await createHome(names)
  const bill = await createBill(homeId, totalCents)
  const [first, second] = bill.body.shares
  if (!first || !second) throw new Error('bill needs two shares')
  return { homeId, members, billId: bill.body.id, first, second }
}

describe('pay: keys and not-found cases', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('rejects a %s Idempotency-Key with 400 and leaves the share unpaid', async (_, key) => {
    const { homeId, billId, first } = await setup()

    const response = await pay(billId, first.id, key)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: expect.any(String) })
    expect(await storedShare(first.id)).toEqual({ paid_at: null, idempotency_key: null })
    expect(await outstanding(homeId)).toEqual([334, 333, 333])
  })

  it('returns the paid share in the documented shape', async () => {
    const { billId, first } = await setup()

    const response = await pay(billId, first.id, 'key-1')

    expect(response.body).toEqual({
      id: first.id,
      memberId: first.memberId,
      amountCents: 334,
      paidAt: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(response.body.paidAt ?? ''))).toBe(false)
  })

  it('returns 404 and changes nothing when the share belongs to another bill', async () => {
    const { homeId, first } = await setup()
    const otherBill = await createBill(homeId, 50)

    const response = await pay(otherBill.body.id, first.id, 'key-1')

    expect(response.status).toBe(404)
    expect(await storedShare(first.id)).toEqual({ paid_at: null, idempotency_key: null })
  })

  it('returns 404 when both bill and share do not exist', async () => {
    const response = await pay('no-bill', 'no-share', 'key-1')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: expect.any(String) })
  })

  it('keeps the first paidAt and key after a 409', async () => {
    const { billId, first } = await setup()
    const original = await pay(billId, first.id, 'first-key')

    const conflict = await pay(billId, first.id, 'second-key')
    const repeat = await pay(billId, first.id, 'first-key')

    expect(conflict.status).toBe(409)
    expect(conflict.body).toEqual({ error: expect.any(String) })
    expect(repeat.status).toBe(200)
    expect(repeat.body).toEqual(original.body)
    expect(await storedShare(first.id)).toEqual({
      paid_at: original.body.paidAt,
      idempotency_key: 'first-key',
    })
  })

  it('lets the same key be used for different shares', async () => {
    const { homeId, billId, first, second } = await setup()

    const a = await pay(billId, first.id, 'shared-key')
    const b = await pay(billId, second.id, 'shared-key')

    expect([a.status, b.status]).toEqual([200, 200])
    expect(await outstanding(homeId)).toEqual([0, 0, 333])
  })

  it('pays a zero-cent share', async () => {
    const { homeId, billId, second } = await setup(['Asha', 'Ben', 'Chitra'], 1)

    const response = await pay(billId, second.id, 'zero')

    expect(response.status).toBe(200)
    expect(response.body.amountCents).toBe(0)
    expect(await outstanding(homeId)).toEqual([1, 0, 0])
  })

  it('does not lower the balance again when a payment is retried many times', async () => {
    const { homeId, billId, first } = await setup()

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await pay(billId, first.id, 'retry-key')).status).toBe(200)
    }

    expect(await outstanding(homeId)).toEqual([0, 333, 333])
  })
})

describe('pay: two requests at the same time', () => {
  const rounds = 25

  it(`lets exactly one of several different keys win (${rounds} rounds)`, async () => {
    for (let round = 0; round < rounds; round++) {
      const { homeId, billId, first } = await setup()
      const keys = ['k1', 'k2', 'k3', 'k4', 'k5'].map((key) => `${key}-${round}`)

      const responses = await Promise.all(keys.map((key) => pay(billId, first.id, key)))
      const statuses = responses.map((response) => response.status).sort()
      const winnerIndex = responses.findIndex((response) => response.status === 200)
      const stored = await storedShare(first.id)

      expect(statuses).toEqual([200, 409, 409, 409, 409])
      expect(stored?.idempotency_key).toBe(keys[winnerIndex])
      expect(stored?.paid_at).toBe(responses[winnerIndex]?.body.paidAt)
      expect(await outstanding(homeId)).toEqual([0, 333, 333])
    }
  })

  it(`returns the same result to every request with the same key (${rounds} rounds)`, async () => {
    for (let round = 0; round < rounds; round++) {
      const { homeId, billId, first } = await setup()
      const key = `same-${round}`

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => pay(billId, first.id, key)),
      )

      expect(responses.every((response) => response.status === 200)).toBe(true)
      const paidAts = new Set(responses.map((response) => response.body.paidAt))
      expect(paidAts.size).toBe(1)
      expect((await storedShare(first.id))?.paid_at).toBe([...paidAts][0])
      expect(await outstanding(homeId)).toEqual([0, 333, 333])
    }
  })

  it('pays different shares of the same bill at the same time', async () => {
    const { homeId, billId } = await setup()
    const shares = (await listBills(homeId)).find((b) => b.id === billId)?.shares ?? []

    const responses = await Promise.all(shares.map((share) => pay(billId, share.id, share.id)))

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    expect(await outstanding(homeId)).toEqual([0, 0, 0])
  })
})

describe('balances: edge cases', () => {
  it('lists members with zero when the home has no bills', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])

    const response = await call('GET', `/api/homes/${homeId}/balances`)

    expect(response.body).toEqual({
      balances: [
        { memberId: members[0]?.id, name: 'Asha', outstandingCents: 0 },
        { memberId: members[1]?.id, name: 'Ben', outstandingCents: 0 },
      ],
    })
  })

  it('returns an empty list for a home with no members', async () => {
    const { homeId } = await createHome([])

    const response = await call('GET', `/api/homes/${homeId}/balances`)

    expect(response).toEqual({ status: 200, body: { balances: [] } })
  })

  it('sums uneven bills, then drops to zero once everything is paid', async () => {
    const { homeId, billId, first, second } = await setup()
    await createBill(homeId, 101)

    expect(await outstanding(homeId)).toEqual([334 + 34, 333 + 34, 333 + 33])

    await pay(billId, first.id, 'a')
    await pay(billId, second.id, 'b')
    expect(await outstanding(homeId)).toEqual([34, 34, 333 + 33])

    for (const bill of await listBills(homeId)) {
      for (const share of bill.shares.filter((s) => s.paidAt === null)) {
        expect((await pay(bill.id, share.id, `pay-${share.id}`)).status).toBe(200)
      }
    }
    expect(await outstanding(homeId)).toEqual([0, 0, 0])
  })

  it('does not count bills from another home with the same member names', async () => {
    const one = await setup(['Asha', 'Ben'], 1000)
    await setup(['Asha', 'Ben'], 9999)

    expect(await outstanding(one.homeId)).toEqual([500, 500])
  })
})

async function listBills(homeId: string) {
  const response = await call<{ bills: { id: string; shares: Share[] }[] }>(
    'GET',
    `/api/homes/${homeId}/bills`,
  )
  return response.body.bills
}
