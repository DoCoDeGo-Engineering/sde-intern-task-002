import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

type Home = { id: string; name: string }
type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; homeId: string; title: string; totalCents: number; shares: Share[] }
type Balance = { memberId: string; name: string; outstandingCents: number }

const app = new Hono<{ Bindings: Env }>()

function fail(status: ContentfulStatusCode, message: string): never {
  throw new HTTPException(status, { message })
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail(400, 'Body must be a JSON object')
  }
  return body as Record<string, unknown>
}

function requireText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length === 0 || text.length > 100) {
    fail(422, `${field} must be a non-empty string of at most 100 characters`)
  }
  return text
}

async function requireHome(db: D1Database, homeId: string): Promise<Home> {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<Home>()
  return home ?? fail(404, 'Home not found')
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const name = requireText((await readBody(c)).name, 'name')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.get('/api/homes/:homeId', async (c) =>
  c.json(await requireHome(c.env.DB, c.req.param('homeId'))),
)

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const name = requireText((await readBody(c)).name, 'name')
  const id = crypto.randomUUID()
  // One statement: the home check and the next position cannot race with another insert.
  const { meta } = await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, position)
     SELECT ?1, id, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM members WHERE home_id = ?3)
     FROM homes WHERE id = ?3`,
  )
    .bind(id, name, homeId)
    .run()
  if (meta.changes === 0) fail(404, 'Home not found')
  return c.json({ id, homeId, name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readBody(c)
  const title = requireText(body.title, 'title')
  const { totalCents } = body
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    fail(422, 'totalCents must be a positive whole number of cents')
  }
  await requireHome(c.env.DB, homeId)
  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) fail(422, 'Home has no members to split the bill between')

  const base = Math.floor(totalCents / members.length)
  const extra = totalCents % members.length
  const shares: Share[] = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    // The first `extra` members pay one cent more, so the shares always add up to the total.
    amountCents: base + (index < extra ? 1 : 0),
    paidAt: null,
  }))
  const billId = crypto.randomUUID()
  // batch() is one transaction: the bill and all its shares are saved, or nothing is.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents, new Date().toISOString()),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])
  const bill: Bill = { id: billId, homeId, title, totalCents, shares }
  return c.json(bill, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  await requireHome(c.env.DB, homeId)
  // One query, so a bill is never read without its shares.
  const { results } = await c.env.DB.prepare(
    `SELECT b.id AS billId, b.title, b.total_cents AS totalCents,
            s.id, s.member_id AS memberId, s.amount_cents AS amountCents, s.paid_at AS paidAt
     FROM bills b
     JOIN shares s ON s.bill_id = b.id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ?
     ORDER BY b.created_at DESC, b.rowid DESC, m.position`,
  )
    .bind(homeId)
    .all<Share & { billId: string; title: string; totalCents: number }>()

  const bills = new Map<string, Bill>()
  for (const { billId, title, totalCents, ...share } of results) {
    const bill = bills.get(billId) ?? { id: billId, homeId, title, totalCents, shares: [] }
    bill.shares.push(share)
    bills.set(billId, bill)
  }
  return c.json({ bills: [...bills.values()] })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')
  if (!key || key.length > 255) fail(400, 'Idempotency-Key header is required (max 255 characters)')
  const { billId, shareId } = c.req.param()
  const columns = 'id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt'

  // Matches only while the share is unpaid. D1 runs one write at a time, so when two
  // requests pay the same share at once, exactly one of them gets the row back.
  const paid = await c.env.DB.prepare(
    `UPDATE shares SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL
     RETURNING ${columns}`,
  )
    .bind(new Date().toISOString(), key, shareId, billId)
    .first<Share>()
  if (paid) return c.json(paid)

  const share = await c.env.DB.prepare(
    `SELECT ${columns}, idempotency_key AS idempotencyKey FROM shares WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<Share & { idempotencyKey: string | null }>()
  if (!share) fail(404, 'Bill or share not found')
  const { idempotencyKey, ...result } = share
  if (idempotencyKey !== key) fail(409, 'Share is already paid')
  return c.json(result)
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  await requireHome(c.env.DB, homeId)
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
     WHERE m.home_id = ?
     GROUP BY m.id
     ORDER BY m.position`,
  )
    .bind(homeId)
    .all<Balance>()
  return c.json({ balances: results })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
