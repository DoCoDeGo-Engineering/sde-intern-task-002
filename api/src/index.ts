import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { splitCents } from './split'
import { readJsonObject, requirePositiveCents, requireText } from './validation'

const app = new Hono<{ Bindings: Env }>()

type HomeRow = { id: string; name: string }
type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
}

function toShare(row: ShareRow) {
  return {
    id: row.id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
  }
}

async function requireHome(db: D1Database, homeId: string): Promise<HomeRow> {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) throw new HTTPException(404, { message: 'Home not found' })
  return home
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.get('/api/homes', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM homes ORDER BY seq',
  ).all<HomeRow>()
  return c.json({ homes: results })
})

app.post('/api/homes', async (c) => {
  const body = await readJsonObject(c.req.raw)
  const name = requireText(body.name, 'name')
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  await requireHome(c.env.DB, homeId)
  const body = await readJsonObject(c.req.raw)
  const name = requireText(body.name, 'name')
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()

  return c.json({ id, homeId, name }, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')
  await requireHome(db, homeId)

  const { results } = await db
    .prepare(
      `SELECT b.id AS bill_id, b.title, b.total_cents,
              s.id, s.member_id, s.amount_cents, s.paid_at
       FROM bills b
       JOIN shares s ON s.bill_id = b.id
       JOIN members m ON m.id = s.member_id
       WHERE b.home_id = ?
       ORDER BY b.seq, m.seq`,
    )
    .bind(homeId)
    .all<ShareRow & { title: string; total_cents: number }>()

  type BillView = {
    id: string
    homeId: string
    title: string
    totalCents: number
    shares: ReturnType<typeof toShare>[]
  }
  const bills: BillView[] = []
  for (const row of results) {
    let bill = bills.at(-1)
    if (bill?.id !== row.bill_id) {
      bill = { id: row.bill_id, homeId, title: row.title, totalCents: row.total_cents, shares: [] }
      bills.push(bill)
    }
    bill.shares.push(toShare(row))
  }

  return c.json({ bills })
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')
  await requireHome(db, homeId)
  const body = await readJsonObject(c.req.raw)
  const title = requireText(body.title, 'title')
  const totalCents = requirePositiveCents(body.totalCents, 'totalCents')

  const { results: members } = await db
    .prepare('SELECT id FROM members WHERE home_id = ? ORDER BY seq')
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) {
    throw new HTTPException(422, { message: 'Home has no members to split the bill between' })
  }

  const billId = crypto.randomUUID()
  const shares = splitCents(
    totalCents,
    members.map((member) => member.id),
  ).map((share) => ({ id: crypto.randomUUID(), ...share, paidAt: null }))

  await db.batch([
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      db
        .prepare(
          'INSERT INTO shares (id, bill_id, home_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(share.id, billId, homeId, share.memberId, share.amountCents),
    ),
  ])

  return c.json({ id: billId, homeId, title, totalCents, shares }, 201)
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const db = c.env.DB
  const { billId, shareId } = c.req.param()
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) throw new HTTPException(400, { message: 'Idempotency-Key header is required' })

  const paid = await db
    .prepare(
      `UPDATE shares SET paid_at = ?, idempotency_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL
       RETURNING id, bill_id, member_id, amount_cents, paid_at`,
    )
    .bind(new Date().toISOString(), key, shareId, billId)
    .first<ShareRow>()
  if (paid) return c.json(toShare(paid))

  const existing = await db
    .prepare(
      `SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key
       FROM shares WHERE id = ? AND bill_id = ?`,
    )
    .bind(shareId, billId)
    .first<ShareRow & { idempotency_key: string | null }>()
  if (!existing) throw new HTTPException(404, { message: 'Bill or share not found' })
  if (existing.idempotency_key !== key) {
    throw new HTTPException(409, { message: 'Share was already paid with a different key' })
  }
  return c.json(toShare(existing))
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')
  await requireHome(db, homeId)

  const { results } = await db
    .prepare(
      `SELECT m.id AS memberId, m.name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
       FROM members m
       LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
       WHERE m.home_id = ?
       GROUP BY m.seq
       ORDER BY m.seq`,
    )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: results })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
