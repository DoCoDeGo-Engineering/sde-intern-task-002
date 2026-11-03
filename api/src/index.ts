import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { splitCents } from './split'
import { fail, readCents, readObject, readText } from './validate'

type Home = { id: string; name: string }
type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; homeId: string; title: string; totalCents: number; shares: Share[] }

const app = new Hono<{ Bindings: Env }>()

async function requireHome(db: D1Database, homeId: string): Promise<Home> {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<Home>()
  return home ?? fail(404, 'Home not found')
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.get('/api/homes', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM homes ORDER BY rowid',
  ).all<Home>()
  return c.json({ homes: results })
})

app.post('/api/homes', async (c) => {
  const body = await readObject(c.req.raw)
  const name = readText(body.name, 'name')
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const home = await requireHome(c.env.DB, c.req.param('homeId'))
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(home.id)
    .all<{ id: string; name: string }>()

  return c.json({ ...home, members: results })
})

app.post('/api/homes/:homeId/members', async (c) => {
  const home = await requireHome(c.env.DB, c.req.param('homeId'))
  const body = await readObject(c.req.raw)
  const name = readText(body.name, 'name')
  const id = crypto.randomUUID()

  /*
    The position is worked out inside the INSERT itself. If it was read first
    and written after, two members added at the same time could get the same
    number. With the UNIQUE key on (home_id, position) that would be an error.
  */
  await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, position)
     VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position) + 1, 0) FROM members WHERE home_id = ?2))`,
  )
    .bind(id, home.id, name)
    .run()

  return c.json({ id, homeId: home.id, name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const home = await requireHome(db, c.req.param('homeId'))
  const body = await readObject(c.req.raw)
  const title = readText(body.title, 'title')
  const totalCents = readCents(body.totalCents)

  const { results: members } = await db
    .prepare('SELECT id FROM members WHERE home_id = ? ORDER BY position')
    .bind(home.id)
    .all<{ id: string }>()

  if (members.length === 0) {
    fail(422, 'The home has no members to split the bill between')
  }

  const billId = crypto.randomUUID()
  const amounts = splitCents(totalCents, members.length)
  const shares: Share[] = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: amounts[index] ?? 0,
    paidAt: null,
  }))

  /*
    batch() runs all the statements as one transaction. If one share fails to
    save, the bill is not saved either.
  */
  await db.batch([
    db
      .prepare(
        'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(billId, home.id, title, totalCents, new Date().toISOString()),
    ...shares.map((share) =>
      db
        .prepare(
          'INSERT INTO shares (id, bill_id, member_id, home_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(share.id, billId, share.memberId, home.id, share.amountCents),
    ),
  ])

  const bill: Bill = { id: billId, homeId: home.id, title, totalCents, shares }
  return c.json(bill, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const home = await requireHome(c.env.DB, c.req.param('homeId'))

  const { results } = await c.env.DB.prepare(
    `SELECT b.id AS billId, b.title, b.total_cents AS totalCents,
            s.id AS shareId, s.member_id AS memberId, s.amount_cents AS amountCents, s.paid_at AS paidAt
     FROM bills b
     JOIN shares s ON s.bill_id = b.id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ?
     ORDER BY b.created_at DESC, b.rowid DESC, m.position`,
  )
    .bind(home.id)
    .all<{
      billId: string
      title: string
      totalCents: number
      shareId: string
      memberId: string
      amountCents: number
      paidAt: string | null
    }>()

  const bills = new Map<string, Bill>()
  for (const row of results) {
    let bill = bills.get(row.billId)
    if (!bill) {
      bill = {
        id: row.billId,
        homeId: home.id,
        title: row.title,
        totalCents: row.totalCents,
        shares: [],
      }
      bills.set(row.billId, bill)
    }
    bill.shares.push({
      id: row.shareId,
      memberId: row.memberId,
      amountCents: row.amountCents,
      paidAt: row.paidAt,
    })
  }

  return c.json({ bills: [...bills.values()] })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const db = c.env.DB
  const { billId, shareId } = c.req.param()
  const key = c.req.header('Idempotency-Key')?.trim()

  if (!key || key.length > 200) {
    fail(400, 'Idempotency-Key header is required, up to 200 characters')
  }

  /*
    The UPDATE only matches a share that is still unpaid, and the database runs
    one write at a time. If two requests pay the same share together, one of
    them updates the row and gets it back. The other one gets nothing back.
  */
  const paid = await db
    .prepare(
      `UPDATE shares SET paid_at = ?, idempotency_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL
       RETURNING id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt`,
    )
    .bind(new Date().toISOString(), key, shareId, billId)
    .first<Share>()

  if (paid) {
    return c.json(paid)
  }

  const share = await db
    .prepare(
      `SELECT id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt,
              idempotency_key AS idempotencyKey
       FROM shares WHERE id = ? AND bill_id = ?`,
    )
    .bind(shareId, billId)
    .first<Share & { idempotencyKey: string | null }>()

  if (!share) {
    fail(404, 'Bill or share not found')
  }

  if (share.idempotencyKey !== key) {
    fail(409, 'This share was already paid with a different Idempotency-Key')
  }

  return c.json({
    id: share.id,
    memberId: share.memberId,
    amountCents: share.amountCents,
    paidAt: share.paidAt,
  })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const home = await requireHome(c.env.DB, c.req.param('homeId'))

  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
     WHERE m.home_id = ?
     GROUP BY m.id
     ORDER BY m.position`,
  )
    .bind(home.id)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: results })
})

app.notFound((c) => c.json({ error: 'Route not found' }, 404))

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }

  console.error(error)
  return c.json({ error: 'Something went wrong on the server' }, 500)
})

export default app
