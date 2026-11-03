import { Hono } from 'hono'
import { divideCents } from '../cents'
import { checkTotal, cleanName, homeOr404, parseBody, reject } from '../http'

type ShareOut = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type BillOut = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: ShareOut[]
}

export const homeRoutes = new Hono<{ Bindings: Env }>()

homeRoutes.get('/', async (ctx) => {
  const { results: rawRows } = await ctx.env.DB.prepare(
    'SELECT id, name FROM homes ORDER BY rowid',
  ).all()
  return ctx.json({ homes: rawRows })
})

homeRoutes.post('/', async (ctx) => {
  const payload = await parseBody(ctx.req.raw)
  const newHomeName = cleanName(payload.name, 'name')
  const newId = crypto.randomUUID()

  await ctx.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)')
    .bind(newId, newHomeName)
    .run()

  return ctx.json({ id: newId, name: newHomeName }, 201)
})

homeRoutes.get('/:homeId', async (ctx) => {
  const theHome = await homeOr404(ctx.env.DB, ctx.req.param('homeId'))
  const { results: people } = await ctx.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY join_no',
  )
    .bind(theHome.id)
    .all()

  return ctx.json({ ...theHome, members: people })
})

homeRoutes.post('/:homeId/members', async (ctx) => {
  const theHome = await homeOr404(ctx.env.DB, ctx.req.param('homeId'))
  const payload = await parseBody(ctx.req.raw)
  const personName = cleanName(payload.name, 'name')
  const newId = crypto.randomUUID()

  /*
    join_no is counted inside the INSERT, so it is read and written in one
    step. Members are never removed, so the number of members is the next
    free join_no.
  */
  await ctx.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, join_no)
     VALUES (?1, ?2, ?3, (SELECT COUNT(*) FROM members WHERE home_id = ?2))`,
  )
    .bind(newId, theHome.id, personName)
    .run()

  return ctx.json({ id: newId, homeId: theHome.id, name: personName }, 201)
})

homeRoutes.post('/:homeId/bills', async (ctx) => {
  const database = ctx.env.DB
  const theHome = await homeOr404(database, ctx.req.param('homeId'))
  const payload = await parseBody(ctx.req.raw)
  const billTitle = cleanName(payload.title, 'title')
  const wholeAmount = checkTotal(payload.totalCents)

  const { results: people } = await database
    .prepare('SELECT id FROM members WHERE home_id = ? ORDER BY join_no')
    .bind(theHome.id)
    .all<{ id: string }>()

  if (people.length === 0) {
    reject(422, 'Add a member to this home before adding a bill')
  }

  const billId = crypto.randomUUID()
  const portions = divideCents(wholeAmount, people.length)
  const parts: ShareOut[] = people.map((person, slot) => ({
    id: crypto.randomUUID(),
    memberId: person.id,
    amountCents: portions[slot] ?? 0,
    paidAt: null,
  }))

  /*
    All the statements in batch() run as one transaction. If saving one share
    fails, the bill is not responseBill either.
  */
  await database.batch([
    database
      .prepare(
        'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(billId, theHome.id, billTitle, wholeAmount, new Date().toISOString()),
    ...parts.map((part) =>
      database
        .prepare(
          'INSERT INTO shares (id, bill_id, member_id, home_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(part.id, billId, part.memberId, theHome.id, part.amountCents),
    ),
  ])

  const responseBill: BillOut = {
    id: billId,
    homeId: theHome.id,
    title: billTitle,
    totalCents: wholeAmount,
    shares: parts,
  }
  return ctx.json(responseBill, 201)
})

homeRoutes.get('/:homeId/bills', async (ctx) => {
  const theHome = await homeOr404(ctx.env.DB, ctx.req.param('homeId'))

  const { results: lines } = await ctx.env.DB.prepare(
    `SELECT b.id AS billId, b.title, b.total_cents AS totalCents,
            s.id AS shareId, s.member_id AS memberId, s.amount_cents AS amountCents,
            p.paid_at AS paidAt
     FROM bills b
     JOIN shares s ON s.bill_id = b.id
     JOIN members m ON m.id = s.member_id
     LEFT JOIN payments p ON p.share_id = s.id
     WHERE b.home_id = ?
     ORDER BY b.created_at DESC, b.rowid DESC, m.join_no`,
  )
    .bind(theHome.id)
    .all<{
      billId: string
      title: string
      totalCents: number
      shareId: string
      memberId: string
      amountCents: number
      paidAt: string | null
    }>()

  const grouped = new Map<string, BillOut>()
  for (const line of lines) {
    const group = grouped.get(line.billId) ?? {
      id: line.billId,
      homeId: theHome.id,
      title: line.title,
      totalCents: line.totalCents,
      shares: [],
    }
    group.shares.push({
      id: line.shareId,
      memberId: line.memberId,
      amountCents: line.amountCents,
      paidAt: line.paidAt,
    })
    grouped.set(line.billId, group)
  }

  return ctx.json({ bills: [...grouped.values()] })
})

homeRoutes.get('/:homeId/balances', async (ctx) => {
  const theHome = await homeOr404(ctx.env.DB, ctx.req.param('homeId'))

  const { results: owed } = await ctx.env.DB.prepare(
    `SELECT m.id AS memberId, m.name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.share_id = s.id)
     WHERE m.home_id = ?
     GROUP BY m.id
     ORDER BY m.join_no`,
  )
    .bind(theHome.id)
    .all()

  return ctx.json({ balances: owed })
})
