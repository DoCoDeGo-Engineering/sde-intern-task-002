import { Hono } from 'hono'
import { jsonError } from './lib/response'
import {
  addMember,
  createBill,
  createHome,
  getHome,
  listBalances,
  listMembers,
  payShare,
} from './lib/store'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const db = c.env.DB
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonError(c, 422, 'invalid request body')
  }
  const name =
    typeof body === 'object' && body !== null && 'name' in body
      ? (body as { name: unknown }).name
      : undefined
  if (typeof name !== 'string' || name.length === 0) {
    return jsonError(c, 422, 'name is required')
  }

  const home = await createHome(db, name)
  return c.json({ id: home.id, name: home.name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')

  const home = await getHome(db, homeId)
  if (!home) {
    return jsonError(c, 404, 'home not found')
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonError(c, 422, 'invalid request body')
  }
  const name =
    typeof body === 'object' && body !== null && 'name' in body
      ? (body as { name: unknown }).name
      : undefined
  if (typeof name !== 'string' || name.length === 0) {
    return jsonError(c, 422, 'name is required')
  }

  const member = await addMember(db, homeId, name)
  return c.json({ id: member.id, homeId: member.homeId, name: member.name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')

  const home = await getHome(db, homeId)
  if (!home) {
    return jsonError(c, 404, 'home not found')
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonError(c, 422, 'invalid request body')
  }
  const title =
    typeof body === 'object' && body !== null && 'title' in body
      ? (body as { title: unknown }).title
      : undefined
  const totalCents =
    typeof body === 'object' && body !== null && 'totalCents' in body
      ? (body as { totalCents: unknown }).totalCents
      : undefined
  if (typeof title !== 'string' || title.length === 0) {
    return jsonError(c, 422, 'title is required')
  }
  if (!isPositiveWholeCents(totalCents)) {
    return jsonError(c, 422, 'totalCents must be a positive whole number')
  }

  const members = await listMembers(db, homeId)
  if (members.length === 0) {
    return jsonError(c, 422, 'home has no members')
  }

  const bill = await createBill(db, homeId, title, totalCents, members)
  return c.json(
    {
      id: bill.id,
      homeId: bill.homeId,
      title: bill.title,
      totalCents: bill.totalCents,
      shares: bill.shares.map((share) => ({
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: null,
      })),
    },
    201,
  )
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const db = c.env.DB
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const key = c.req.header('Idempotency-Key')
  if (!key) {
    return jsonError(c, 400, 'Idempotency-Key header is required')
  }

  const result = await payShare(db, billId, shareId, key)
  if (result.status !== 200) {
    return jsonError(c, result.status, result.error)
  }
  return c.json(
    {
      id: result.share.id,
      memberId: result.share.memberId,
      amountCents: result.share.amountCents,
      paidAt: result.share.paidAt,
    },
    200,
  )
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')

  const home = await getHome(db, homeId)
  if (!home) {
    return jsonError(c, 404, 'home not found')
  }

  const balances = await listBalances(db, homeId)
  return c.json({ balances }, 200)
})

function isPositiveWholeCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export default app
