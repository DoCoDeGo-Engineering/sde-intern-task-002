import { describe, expect, it } from 'vitest'
import { type Balance, type Bill, call, createBill, createHome, type Share } from './helpers'

function sendPayment(billId: string, shareId: string, idemKey: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': idemKey },
  })
}

async function newBillFor(who: string[], howMuch: number) {
  const flat = await createHome(who)
  const outcome = await createBill(flat.homeId, howMuch)
  const target = outcome.body.shares[0]
  if (!target) throw new Error('no share came back')
  return { homeId: flat.homeId, billId: outcome.body.id, target }
}

async function owedBy(homeId: string) {
  const answer = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
  return answer.body.balances.map((entry) => entry.outstandingCents)
}

describe('dividing a bill', () => {
  it('gives 1 cent to each of the first 5 members when 5 cents are shared between 7', async () => {
    const flat = await createHome(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

    const outcome = await createBill(flat.homeId, 5)

    expect(outcome.body.shares.map((entry) => entry.amountCents)).toEqual([1, 1, 1, 1, 1, 0, 0])
  })

  it('keeps one clean order when 6 members are added in the same moment', async () => {
    const made = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'House' } })
    const homeId = made.body.id

    await Promise.all(
      ['Meera', 'Kabir', 'Tara', 'Imran', 'Nisha', 'Joy'].map((personName) =>
        call('POST', `/api/homes/${homeId}/members`, { body: { name: personName } }),
      ),
    )

    const details = await call<{ members: { id: string }[] }>('GET', `/api/homes/${homeId}`)
    const joinedIds = details.body.members.map((entry) => entry.id)
    const outcome = await createBill(homeId, 600)
    expect(new Set(joinedIds).size).toBe(6)
    expect(outcome.body.shares.map((entry) => entry.memberId)).toEqual(joinedIds)
  })
})

describe('paying a share', () => {
  it('lets one of two different keys win when both arrive in the same moment', async () => {
    const { billId, target } = await newBillFor(['Meera', 'Kabir'], 900)

    const answers = await Promise.all([
      sendPayment(billId, target.id, crypto.randomUUID()),
      sendPayment(billId, target.id, crypto.randomUUID()),
    ])

    expect(answers.map((entry) => entry.status).sort()).toEqual([200, 409])
  })

  it('answers the same key sent in the same moment with the same payment', async () => {
    const { homeId, billId, target } = await newBillFor(['Meera', 'Kabir'], 900)
    const sameKey = crypto.randomUUID()

    const [left, right] = await Promise.all([
      sendPayment(billId, target.id, sameKey),
      sendPayment(billId, target.id, sameKey),
    ])

    expect([left.status, right.status]).toEqual([200, 200])
    expect(right.body).toEqual(left.body)
    expect(await owedBy(homeId)).toEqual([0, 450])
  })

  it('still knows the first key after another key was turned down', async () => {
    const { billId, target } = await newBillFor(['Meera'], 700)
    const firstKey = crypto.randomUUID()
    const firstPayment = await sendPayment(billId, target.id, firstKey)

    const turnedDown = await sendPayment(billId, target.id, crypto.randomUUID())
    const replay = await sendPayment(billId, target.id, firstKey)

    expect(turnedDown.status).toBe(409)
    expect(replay.status).toBe(200)
    expect(replay.body.paidAt).toBe(firstPayment.body.paidAt)
  })

  it('does not find a share when it is asked for through another bill', async () => {
    const west = await newBillFor(['Meera'], 100)
    const east = await newBillFor(['Kabir'], 100)

    const answer = await sendPayment(east.billId, west.target.id, crypto.randomUUID())

    expect(answer.status).toBe(404)
  })

  it('turns down a key that is longer than 200 characters', async () => {
    const { billId, target } = await newBillFor(['Meera'], 100)

    const answer = await sendPayment(billId, target.id, 'x'.repeat(201))

    expect(answer.status).toBe(400)
  })

  it('leaves the share unpaid when the request has no key', async () => {
    const { homeId, billId, target } = await newBillFor(['Meera'], 100)

    await call('POST', `/api/bills/${billId}/shares/${target.id}/pay`)

    const listing = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)
    expect(listing.body.bills[0]?.shares[0]?.paidAt).toBeNull()
  })
})

describe('input that is wrong', () => {
  it.each([
    ['nothing in it', { name: '' }],
    ['only spaces', { name: '   ' }],
    ['a number', { name: 7 }],
    ['no name field', {}],
    ['101 characters', { name: 'n'.repeat(101) }],
  ])('turns down a home name with %s', async (_label, payload) => {
    const answer = await call('POST', '/api/homes', { body: payload })

    expect(answer.status).toBe(422)
  })

  it('turns down a body that is not JSON and still answers in JSON', async () => {
    const answer = await call<{ error: string }>('POST', '/api/homes', { body: undefined })

    expect(answer.status).toBe(400)
    expect(answer.body).toEqual({ error: expect.any(String) })
  })

  it('turns down a total that is too big to be exact', async () => {
    const { homeId } = await createHome(['Meera'])

    const answer = await createBill(homeId, 2 ** 53)

    expect(answer.status).toBe(422)
  })

  it('turns down a bill with a blank title', async () => {
    const { homeId } = await createHome(['Meera'])

    const answer = await call('POST', `/api/homes/${homeId}/bills`, {
      body: { title: '   ', totalCents: 100 },
    })

    expect(answer.status).toBe(422)
  })

  it('answers a route that does not exist in JSON', async () => {
    const answer = await call<{ error: string }>('GET', '/api/no-such-thing')

    expect(answer.status).toBe(404)
    expect(answer.body).toEqual({ error: expect.any(String) })
  })
})

describe('reading', () => {
  it('shows 0 for everybody when the home has no bills', async () => {
    const { homeId } = await createHome(['Meera', 'Kabir'])

    expect(await owedBy(homeId)).toEqual([0, 0])
  })

  it('lists the newest bill first and its shares in the order members joined', async () => {
    const { homeId, members: joined } = await createHome(['Meera', 'Kabir'])
    await createBill(homeId, 100)
    const latest = await createBill(homeId, 300)

    const listing = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(listing.body.bills[0]?.id).toBe(latest.body.id)
    expect(listing.body.bills[0]?.shares.map((entry) => entry.memberId)).toEqual(
      joined.map((entry) => entry.id),
    )
  })
})
