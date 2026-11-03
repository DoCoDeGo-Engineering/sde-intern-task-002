/*
  Shares out `wholeAmount` cents between `headcount` people.
  Each person gets the whole number of cents that fits. The cents that are
  left are handed out one by one from the first person on.
  Example: 1000 cents, 3 people -> 334, 333, 333
*/
export function divideCents(wholeAmount: number, headcount: number): number[] {
  const each = Math.floor(wholeAmount / headcount)
  const leftOver = wholeAmount - each * headcount

  return Array.from({ length: headcount }, (_, slot) => (slot < leftOver ? each + 1 : each))
}
