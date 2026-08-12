export interface RandomSource {
  next(): number;
  integer(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  const next = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    integer(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0)
        throw new RangeError("maxExclusive must be positive");
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("Cannot pick from an empty list");
      return items[this.integer(items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const other = this.integer(index + 1);
        [result[index], result[other]] = [result[other] as T, result[index] as T];
      }
      return result;
    },
  };
}
