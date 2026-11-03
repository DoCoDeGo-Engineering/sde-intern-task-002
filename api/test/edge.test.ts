import { describe, expect, it } from 'vitest'
import { type Balance, type Bill, call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

async function billWithFirstShare(memberNames: string[], totalCents: number) {
  const { homeId, members } = await createHome(memberNames)
  const bill = await createBill(homeId, totalCents)
  const share = bill.body.shares[0]
  if (!share) throw new Error('the bill has no shares')
  return { homeId, members, billId: bill.body.id, share }
}

describe('splitting', () => {
  it('gives one cent each to the first members when there are fewer cents than members', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const bill = await createBill(homeId, 2)

    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([1, 1, 0])
  })

  it('keeps the order of the members when they are added at the same time', async () => {
    const home = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Flat' } })
    const names = ['Asha', 'Ben', 'Chitra', 'Dev', 'Esha']

    await Promise.all(
      names.map((name) => call('POST', `/api/homes/${home.body.id}/members`, { body: { name } })),
    )

    const bill = await createBill(home.body.id, 5)
    const details = await call<{ members: { id: string; name: string }[] }>(
      'GET',
      `/api/homes/${home.body.id}`,
    )
    const memberIds = details.body.members.map((member) => member.id)
    expect(memberIds).toHaveLength(5)
    expect(new Set(memberIds).size).toBe(5)
    expect(bill.body.shares.map((share) => share.memberId)).toEqual(memberIds)
  })
})

describe('paying', () => {
  it('lets only one of two payments with different keys win when they arrive together', async () => {
    const { billId, share } = await billWithFirstShare(['Asha', 'Ben'], 1000)

    const results = await Promise.all([
      pay(billId, share.id, crypto.randomUUID()),
      pay(billId, share.id, crypto.randomUUID()),
    ])

    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
  })

  it('answers two payments with the same key, sent together, with the same result', async () => {
    const { homeId, billId, share } = await billWithFirstShare(['Asha', 'Ben'], 1000)
    const key = crypto.randomUUID()

    const [first, second] = await Promise.all([
      pay(billId, share.id, key),
      pay(billId, share.id, key),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balances.body.balances.map((balance) => balance.outstandingCents)).toEqual([0, 500])
  })

  it('keeps the first key after a second key was refused', async () => {
    const { billId, share } = await billWithFirstShare(['Asha'], 700)
    const firstKey = crypto.randomUUID()
    const first = await pay(billId, share.id, firstKey)

    const refused = await pay(billId, share.id, crypto.randomUUID())
    const again = await pay(billId, share.id, firstKey)

    expect(refused.status).toBe(409)
    expect(again.status).toBe(200)
    expect(again.body.paidAt).toBe(first.body.paidAt)
  })

  it('does not find a share through the wrong bill', async () => {
    const first = await billWithFirstShare(['Asha'], 100)
    const second = await billWithFirstShare(['Ben'], 100)

    const paid = await pay(second.billId, first.share.id, crypto.randomUUID())

    expect(paid.status).toBe(404)
  })

  it('refuses a key that is too long', async () => {
    const { billId, share } = await billWithFirstShare(['Asha'], 100)

    const paid = await pay(billId, share.id, 'k'.repeat(201))

    expect(paid.status).toBe(400)
  })

  it('does not mark the share as paid when the request is refused', async () => {
    const { homeId, billId, share } = await billWithFirstShare(['Asha'], 100)

    await call('POST', `/api/bills/${billId}/shares/${share.id}/pay`)

    const bills = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)
    expect(bills.body.bills[0]?.shares[0]?.paidAt).toBeNull()
  })
})

describe('input that is not valid', () => {
  it.each([
    ['an empty name', { name: '' }],
    ['a name with only spaces', { name: '   ' }],
    ['a name that is not a string', { name: 42 }],
    ['no name', {}],
    ['a name that is too long', { name: 'a'.repeat(101) }],
  ])('refuses a home with %s', async (_label, body) => {
    const created = await call('POST', '/api/homes', { body })

    expect(created.status).toBe(422)
  })

  it('refuses a body that is not JSON', async () => {
    const response = await call<{ error: string }>('POST', '/api/homes', { body: undefined })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: expect.any(String) })
  })

  it('refuses a total that is too big to be exact', async () => {
    const { homeId } = await createHome(['Asha'])

    const bill = await createBill(homeId, 2 ** 53)

    expect(bill.status).toBe(422)
  })

  it('refuses a bill with a blank title', async () => {
    const { homeId } = await createHome(['Asha'])

    const bill = await call('POST', `/api/homes/${homeId}/bills`, {
      body: { title: '  ', totalCents: 100 },
    })

    expect(bill.status).toBe(422)
  })

  it('answers an unknown route with JSON', async () => {
    const response = await call<{ error: string }>('GET', '/api/nothing-here')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: expect.any(String) })
  })
})

describe('reading', () => {
  it('shows zero for every member of a home that has no bills', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])

    const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)

    expect(balances.body.balances.map((balance) => balance.outstandingCents)).toEqual([0, 0])
  })

  it('lists the newest bill first, with its shares in member order', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 100)
    const newest = await createBill(homeId, 300)

    const bills = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(bills.body.bills.map((bill) => bill.id)[0]).toBe(newest.body.id)
    expect(bills.body.bills[0]?.shares.map((share) => share.memberId)).toEqual(
      members.map((member) => member.id),
    )
  })
})
