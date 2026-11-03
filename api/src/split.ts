export type SplitShare = { memberId: string; amountCents: number }

export function splitCents(totalCents: number, memberIds: readonly string[]): SplitShare[] {
  const count = memberIds.length
  const remainder = totalCents % count
  const base = (totalCents - remainder) / count

  return memberIds.map((memberId, index) => ({
    memberId,
    amountCents: index < remainder ? base + 1 : base,
  }))
}
