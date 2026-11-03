export function showMoney(amountCents: number): string {
  const wholeDollars = Math.floor(amountCents / 100)
  const pennies = String(amountCents % 100).padStart(2, '0')
  return `$${wholeDollars}.${pennies}`
}

/*
  Turns what the person typed, like "12", "12.5" or "12.34", into cents
  without decimal arithmetic, because 0.1 + 0.2 is not exactly 0.3 in
  JavaScript. Returns null when it is not an amount with at most 2 decimals.
*/
export function typedToCents(typed: string): number | null {
  const parts = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(typed.trim())
  if (!parts) {
    return null
  }

  const dollarPart = Number(parts[1])
  const centPart = Number((parts[2] ?? '').padEnd(2, '0'))
  const combined = dollarPart * 100 + centPart

  return combined > 0 ? combined : null
}
