interface HomeRow {
  id: string
  name: string
}

interface MemberRow {
  id: string
  home_id: string
  name: string
  position: number
}

interface ShareRow {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

interface BalanceRow {
  memberId: string
  name: string
  outstandingCents: number
}

export interface Home {
  id: string
  name: string
}

export interface Member {
  id: string
  homeId: string
  name: string
}

export interface Share {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

export type PayOutcome =
  | { status: 200; share: Share }
  | { status: 404; error: string }
  | { status: 409; error: string }

export interface Balance {
  memberId: string
  name: string
  outstandingCents: number
}

export async function getHome(db: D1Database, homeId: string): Promise<Home | null> {
  const row = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!row) return null
  return { id: row.id, name: row.name }
}

export async function createHome(db: D1Database, name: string): Promise<Home> {
  const id = crypto.randomUUID()
  await db.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return { id, name }
}

export async function addMember(db: D1Database, homeId: string, name: string): Promise<Member> {
  const id = crypto.randomUUID()
  const positionRow = await db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM members WHERE home_id = ?')
    .bind(homeId)
    .first<{ position: number }>()
  const position = positionRow?.position ?? 0
  await db
    .prepare('INSERT INTO members (id, home_id, name, position) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, position)
    .run()
  return { id, homeId, name }
}

export async function listMembers(db: D1Database, homeId: string): Promise<Member[]> {
  const rows = await db
    .prepare('SELECT id, home_id, name, position FROM members WHERE home_id = ? ORDER BY position')
    .bind(homeId)
    .all<MemberRow>()
  return rows.results.map((row) => ({ id: row.id, homeId: row.home_id, name: row.name }))
}

function splitAmount(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count)
  const remainder = totalCents % count
  const shares: number[] = []
  for (let i = 0; i < count; i++) {
    shares.push(i < remainder ? base + 1 : base)
  }
  return shares
}

export async function createBill(
  db: D1Database,
  homeId: string,
  title: string,
  totalCents: number,
  members: Member[],
): Promise<{
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}> {
  const id = crypto.randomUUID()
  const amounts = splitAmount(totalCents, members.length)
  const shares: {
    id: string
    billId: string
    memberId: string
    amountCents: number
  }[] = amounts.map((amountCents, index) => {
    const member = members[index]
    if (!member) throw new Error('member missing')
    return { id: crypto.randomUUID(), billId: id, memberId: member.id, amountCents }
  })

  const statements = [
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(id, homeId, title, totalCents),
    ...shares.map((share) =>
      db
        .prepare(
          'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, NULL)',
        )
        .bind(share.id, share.billId, share.memberId, share.amountCents),
    ),
  ]
  await db.batch(statements)

  return {
    id,
    homeId,
    title,
    totalCents,
    shares: shares.map((share) => ({
      id: share.id,
      memberId: share.memberId,
      amountCents: share.amountCents,
      paidAt: null,
    })),
  }
}

export async function payShare(
  db: D1Database,
  billId: string,
  shareId: string,
  key: string,
): Promise<PayOutcome> {
  const share = await db
    .prepare(
      'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
    )
    .bind(shareId)
    .first<ShareRow>()

  if (!share) {
    return { status: 404, error: 'share not found' }
  }
  if (share.bill_id !== billId) {
    return { status: 404, error: 'bill or share not found' }
  }

  const paidAt = new Date().toISOString()

  if (share.paid_at !== null) {
    if (share.idempotency_key === key) {
      return { status: 200, share: toShare(share) }
    }
    return { status: 409, error: 'share already paid with a different key' }
  }

  const update = await db
    .prepare('UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL')
    .bind(paidAt, key, shareId)
    .run()

  if (update.meta.changes === 1) {
    return {
      status: 200,
      share: { id: share.id, memberId: share.member_id, amountCents: share.amount_cents, paidAt },
    }
  }

  // Another request paid the same share at the same time. Re-read to decide.
  const current = await db
    .prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
    )
    .bind(shareId)
    .first<ShareRow>()

  if (!current || current.paid_at === null) {
    return { status: 404, error: 'share not found' }
  }
  if (current.idempotency_key === key) {
    return { status: 200, share: toShare(current) }
  }
  return { status: 409, error: 'share already paid with a different key' }
}

function toShare(row: ShareRow): Share {
  return { id: row.id, memberId: row.member_id, amountCents: row.amount_cents, paidAt: row.paid_at }
}

export async function listBalances(db: D1Database, homeId: string): Promise<Balance[]> {
  const rows = await db
    .prepare(`
      SELECT
        m.id AS memberId,
        m.name,
        COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) AS outstandingCents
      FROM members m
      LEFT JOIN shares s ON s.member_id = m.id AND s.bill_id IN (SELECT id FROM bills WHERE home_id = ?)
      WHERE m.home_id = ?
      GROUP BY m.id, m.name
      ORDER BY m.position
    `)
    .bind(homeId, homeId)
    .all<BalanceRow>()
  return rows.results.map((row) => ({
    memberId: row.memberId,
    name: row.name,
    outstandingCents: row.outstandingCents,
  }))
}
