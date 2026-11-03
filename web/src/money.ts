export function formatCents(cents: number) {
  const dollars = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  return `$${dollars.toLocaleString('en-US')}.${rest}`
}

export function parseDollars(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const [, dollars = '', fraction = ''] = match
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}
