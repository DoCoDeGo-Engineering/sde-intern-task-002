import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { type Bill, call, createBill, createHome } from './helpers'
import { countRows, rawPost } from './support'

function postBill(homeId: string, body: unknown) {
  return call<Bill & { error: string }>('POST', `/api/homes/${homeId}/bills`, { body })
}

describe('bill amounts', () => {
  it.each([
    0,
    -1,
    -100,
    0.5,
    10.5,
    1000.001,
    null,
    '1000',
    '',
    true,
    {},
    [1000],
    Number.MAX_SAFE_INTEGER + 1,
    1e300,
  ])('rejects totalCents %j with 422 and saves nothing', async (totalCents) => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bills = await countRows('bills')
    const shares = await countRows('shares')

    const response = await postBill(homeId, { title: 'Rent', totalCents })

    expect(response.status).toBe(422)
    expect(response.body.error).toEqual(expect.any(String))
    expect(await countRows('bills')).toBe(bills)
    expect(await countRows('shares')).toBe(shares)
  })

  it('rejects a missing totalCents', async () => {
    const { homeId } = await createHome(['Asha'])

    const response = await postBill(homeId, { title: 'Rent' })

    expect(response.status).toBe(422)
  })

  it('rejects numbers JSON cannot carry exactly, like 1e400 (Infinity)', async () => {
    const { homeId } = await createHome(['Asha'])

    const response = await rawPost(`/api/homes/${homeId}/bills`, '{"title":"x","totalCents":1e400}')

    expect(response.status).toBe(422)
  })

  it('accepts the largest safe integer and keeps the sum exact', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const bill = await createBill(homeId, Number.MAX_SAFE_INTEGER)
    const sum = bill.body.shares.reduce((total, share) => total + share.amountCents, 0)

    expect(bill.status).toBe(201)
    expect(sum).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each([
    ['missing', { totalCents: 100 }],
    ['blank', { title: '  ', totalCents: 100 }],
    ['a number', { title: 5, totalCents: 100 }],
  ])('rejects a title that is %s with 422', async (_, body) => {
    const { homeId } = await createHome(['Asha'])

    const response = await postBill(homeId, body)

    expect(response.status).toBe(422)
  })

  it('answers malformed JSON with 400', async () => {
    const { homeId } = await createHome(['Asha'])

    const response = await rawPost(`/api/homes/${homeId}/bills`, 'not json')

    expect(response.status).toBe(400)
  })

  it('creates several bills at the same time, each with a full set of shares', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const created = await Promise.all(
      [100, 200, 301, 1000, 7].map((total) => createBill(homeId, total)),
    )
    const list = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(created.every((bill) => bill.status === 201)).toBe(true)
    expect(list.body.bills).toHaveLength(5)
    for (const bill of list.body.bills) {
      expect(bill.shares).toHaveLength(3)
      expect(bill.shares.reduce((sum, share) => sum + share.amountCents, 0)).toBe(bill.totalCents)
    }
  })

  it('returns 422 and saves nothing for a home with no members', async () => {
    const { homeId } = await createHome([])
    const before = await countRows('bills')

    const response = await createBill(homeId, 1000)

    expect(response.status).toBe(422)
    expect(await countRows('bills')).toBe(before)
  })
})

describe('bill splitting through the API', () => {
  it.each([
    [1, 3, [1, 0, 0]],
    [2, 3, [1, 1, 0]],
    [5, 4, [2, 1, 1, 1]],
    [1000, 3, [334, 333, 333]],
    [7, 2, [4, 3]],
  ])('splits %i cents between %i members as %j', async (total, count, expected) => {
    const names = Array.from({ length: count }, (_, index) => `M${index}`)
    const { homeId, members } = await createHome(names)

    const bill = await createBill(homeId, total)

    expect(bill.body.shares.map((share) => share.amountCents)).toEqual(expected)
    expect(bill.body.shares.map((share) => share.memberId)).toEqual(members.map((m) => m.id))
  })

  it('splits 100001 cents between 7 members as 14286 x 6 then 14285', async () => {
    const { homeId } = await createHome(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

    const bill = await createBill(homeId, 100001)

    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([
      14286, 14286, 14286, 14286, 14286, 14286, 14285,
    ])
  })

  it('splits between 60 members', async () => {
    const names = Array.from({ length: 60 }, (_, index) => `M${index}`)
    const { homeId } = await createHome(names)

    const bill = await createBill(homeId, 1000)
    const amounts = bill.body.shares.map((share) => share.amountCents)

    expect(bill.status).toBe(201)
    expect(amounts).toHaveLength(60)
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(1000)
    expect(amounts.slice(0, 40).every((amount) => amount === 17)).toBe(true)
    expect(amounts.slice(40).every((amount) => amount === 16)).toBe(true)
  })

  it('returns the full bill shape', async () => {
    const { homeId, members } = await createHome(['Asha'])

    const bill = await createBill(homeId, 250)

    expect(bill.body).toEqual({
      id: expect.any(String),
      homeId,
      title: 'Electricity',
      totalCents: 250,
      shares: [
        { id: expect.any(String), memberId: members[0]?.id, amountCents: 250, paidAt: null },
      ],
    })
  })

  it('only splits between members who existed when the bill was made', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 1000)
    await call('POST', `/api/homes/${homeId}/members`, { body: { name: 'Late' } })

    const balances = await call<{ balances: { outstandingCents: number }[] }>(
      'GET',
      `/api/homes/${homeId}/balances`,
    )

    expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([500, 500, 0])
  })

  it('lists the bills of a home with their shares, and saves them', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const first = await createBill(homeId, 100)
    const second = await createBill(homeId, 301)

    const list = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(list.status).toBe(200)
    expect(list.body.bills).toEqual([first.body, second.body])
  })

  it('returns an empty bill list for a new home, and 404 for an unknown home', async () => {
    const { homeId } = await createHome(['Asha'])

    const empty = await call('GET', `/api/homes/${homeId}/bills`)
    const missing = await call('GET', '/api/homes/does-not-exist/bills')

    expect(empty).toEqual({ status: 200, body: { bills: [] } })
    expect(missing.status).toBe(404)
  })
})

describe('database constraints', () => {
  async function seed() {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const member = members[0]
    if (!member) throw new Error('no member')
    return { homeId, member, bill: bill.body }
  }

  function insertShare(values: {
    billId: string
    homeId: string
    memberId: string
    amountCents: unknown
  }) {
    return env.DB.prepare(
      'INSERT INTO shares (id, bill_id, home_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), values.billId, values.homeId, values.memberId, values.amountCents)
      .run()
  }

  it('rejects a member of a home that does not exist', async () => {
    const insert = env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), 'no-such-home', 'Ghost')
      .run()

    await expect(insert).rejects.toThrow(/FOREIGN KEY/)
  })

  it('rejects a bill with a total that is not positive', async () => {
    const { homeId } = await seed()

    const insert = env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), homeId, 'Bad', 0)
      .run()

    await expect(insert).rejects.toThrow(/bills_total_positive_integer|CHECK/)
  })

  it('rejects a second share for the same member in the same bill', async () => {
    const { homeId, member, bill } = await seed()

    const insert = insertShare({ billId: bill.id, homeId, memberId: member.id, amountCents: 1 })

    await expect(insert).rejects.toThrow(/UNIQUE/)
  })

  it('rejects a negative share', async () => {
    const { homeId, member } = await seed()
    const billId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(billId, homeId, 'Direct', 10)
      .run()

    const insert = insertShare({ billId, homeId, memberId: member.id, amountCents: -1 })
    const fraction = insertShare({ billId, homeId, memberId: member.id, amountCents: 1.5 })

    await expect(insert).rejects.toThrow(/CHECK/)
    await expect(fraction).rejects.toThrow(/CHECK/)
    await env.DB.prepare('DELETE FROM bills WHERE id = ?').bind(billId).run()
  })

  it('rejects a share whose member belongs to another home', async () => {
    const { homeId, bill } = await seed()
    const other = await createHome(['Stranger'])
    const stranger = other.members[0]
    if (!stranger) throw new Error('no member')

    await expect(
      insertShare({ billId: bill.id, homeId, memberId: stranger.id, amountCents: 1 }),
    ).rejects.toThrow(/FOREIGN KEY/)
    await expect(
      insertShare({ billId: bill.id, homeId: other.homeId, memberId: stranger.id, amountCents: 1 }),
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  it('rejects a paid share without its idempotency key', async () => {
    const { bill } = await seed()
    const share = bill.shares[0]
    if (!share) throw new Error('no share')

    const update = env.DB.prepare('UPDATE shares SET paid_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), share.id)
      .run()

    await expect(update).rejects.toThrow(/CHECK/)
  })

  it('rolls back the whole bill when one share insert fails', async () => {
    const { homeId, member } = await seed()
    const billId = crypto.randomUUID()
    const bills = await countRows('bills')
    const shares = await countRows('shares')

    const batch = env.DB.batch([
      env.DB.prepare(
        'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
      ).bind(billId, homeId, 'Half saved?', 100),
      env.DB.prepare(
        'INSERT INTO shares (id, bill_id, home_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), billId, homeId, member.id, 100),
      env.DB.prepare(
        'INSERT INTO shares (id, bill_id, home_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), billId, homeId, 'no-such-member', 0),
    ])

    await expect(batch).rejects.toThrow()
    expect(await countRows('bills')).toBe(bills)
    expect(await countRows('shares')).toBe(shares)
  })

  it('has no orphan rows after all the API calls in this file', async () => {
    const orphans = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM members m LEFT JOIN homes h ON h.id = m.home_id WHERE h.id IS NULL)
       + (SELECT COUNT(*) FROM bills b LEFT JOIN homes h ON h.id = b.home_id WHERE h.id IS NULL)
       + (SELECT COUNT(*) FROM shares s LEFT JOIN bills b ON b.id = s.bill_id WHERE b.id IS NULL)
       + (SELECT COUNT(*) FROM bills b WHERE b.total_cents <>
           (SELECT COALESCE(SUM(amount_cents), 0) FROM shares s WHERE s.bill_id = b.id))
       AS n`,
    ).first<{ n: number }>()

    expect(orphans?.n).toBe(0)
  })
})
