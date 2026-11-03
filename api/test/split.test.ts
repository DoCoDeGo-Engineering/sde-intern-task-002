import { describe, expect, it } from 'vitest'
import { splitCents } from '../src/split'

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `m${index}`)
}

function amounts(totalCents: number, count: number) {
  return splitCents(totalCents, ids(count)).map((share) => share.amountCents)
}

describe('splitCents', () => {
  it.each([
    [1000, 3, [334, 333, 333]],
    [3000, 3, [1000, 1000, 1000]],
    [1, 3, [1, 0, 0]],
    [2, 3, [1, 1, 0]],
    [5, 4, [2, 1, 1, 1]],
    [4999, 1, [4999]],
    [7, 2, [4, 3]],
  ])('splits %i cents between %i members as %j', (total, count, expected) => {
    expect(amounts(total, count)).toEqual(expected)
  })

  it('keeps the member order', () => {
    expect(splitCents(10, ['c', 'a', 'b']).map((share) => share.memberId)).toEqual(['c', 'a', 'b'])
  })

  it('is exact for the largest safe integer', () => {
    const shares = amounts(Number.MAX_SAFE_INTEGER, 7)
    expect(shares.reduce((sum, amount) => sum + amount, 0)).toBe(Number.MAX_SAFE_INTEGER)
    expect(shares.every(Number.isSafeInteger)).toBe(true)
  })

  it('holds the split rules for every total from 1 to 500 and 1 to 12 members', () => {
    for (let count = 1; count <= 12; count++) {
      for (let total = 1; total <= 500; total++) {
        const shares = amounts(total, count)
        const max = Math.max(...shares)
        const min = Math.min(...shares)

        expect(shares).toHaveLength(count)
        expect(shares.reduce((sum, amount) => sum + amount, 0)).toBe(total)
        expect(shares.every((amount) => Number.isInteger(amount) && amount >= 0)).toBe(true)
        expect(max - min).toBeLessThanOrEqual(1)
        expect([...shares].sort((a, b) => b - a)).toEqual(shares)
      }
    }
  })
})
