import { Hono } from 'hono'
import { reject } from '../http'

export const billRoutes = new Hono<{ Bindings: Env }>()

billRoutes.post('/:billId/shares/:shareId/pay', async (ctx) => {
  const database = ctx.env.DB
  const { billId, shareId } = ctx.req.param()
  const payKey = ctx.req.header('Idempotency-Key')?.trim()

  if (!payKey || payKey.length > 200) {
    reject(400, 'The Idempotency-Key header is missing or longer than 200 characters')
  }

  /*
    Paying means adding a row to payments. The primary key on share_id lets
    only one row in for each share, so when two requests come at the same time
    the second INSERT does nothing (ON CONFLICT DO NOTHING).
    The INSERT only adds a row if the share exists in this bill.
  */
  await database
    .prepare(
      `INSERT INTO payments (share_id, pay_key, paid_at)
       SELECT id, ?, ? FROM shares WHERE id = ? AND bill_id = ?
       ON CONFLICT (share_id) DO NOTHING`,
    )
    .bind(payKey, new Date().toISOString(), shareId, billId)
    .run()

  /*
    Now read what is saved. If the key in the payment is ours, either this
    request paid or the same request was sent before: answer with the payment.
    If it is another key, somebody else paid this share first.
  */
  const found = await database
    .prepare(
      `SELECT s.id, s.member_id AS memberId, s.amount_cents AS amountCents,
              p.paid_at AS paidAt, p.pay_key AS savedKey
       FROM shares s
       LEFT JOIN payments p ON p.share_id = s.id
       WHERE s.id = ? AND s.bill_id = ?`,
    )
    .bind(shareId, billId)
    .first<{
      id: string
      memberId: string
      amountCents: number
      paidAt: string | null
      savedKey: string | null
    }>()

  if (!found) {
    reject(404, 'No such bill or share')
  }

  if (found.savedKey !== payKey) {
    reject(409, 'This share was already paid with another Idempotency-Key')
  }

  return ctx.json({
    id: found.id,
    memberId: found.memberId,
    amountCents: found.amountCents,
    paidAt: found.paidAt,
  })
})
