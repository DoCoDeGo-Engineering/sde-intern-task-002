/*
  Splits an amount of cents between `count` people.
  Everyone gets the same whole number of cents. What is left over is given out
  one cent at a time, starting from the first person.
  1000 cents between 3 people -> 334, 333, 333
*/
export function splitCents(totalCents: number, count: number): number[] {
  const each = Math.floor(totalCents / count)
  const leftover = totalCents % count
  const amounts: number[] = []

  for (let i = 0; i < count; i++) {
    amounts.push(i < leftover ? each + 1 : each)
  }

  return amounts
}
