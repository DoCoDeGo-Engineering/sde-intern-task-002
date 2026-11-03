export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  return `$${dollars}.${rest}`
}

/*
  Turns text like "12", "12.5" or "12.34" into cents without using decimals,
  because 0.1 + 0.2 is not exactly 0.3 in JavaScript.
  Returns null when the text is not an amount with at most 2 decimal places.
*/
export function parseToCents(text: string): number | null {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) {
    return null
  }

  const dollars = Number(match[1])
  const cents = Number((match[2] ?? '').padEnd(2, '0'))
  const total = dollars * 100 + cents

  return total > 0 ? total : null
}
