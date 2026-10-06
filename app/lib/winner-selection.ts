import { randomInt } from "node:crypto";

export function pickRandom<T>(items: T[], count: number): T[] {
  const pool = [...items];
  const selectedCount = Math.min(count, pool.length);
  for (let index = 0; index < selectedCount; index += 1) {
    const swapIndex = index + randomInt(pool.length - index);
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, selectedCount);
}

export function pickRaffleWinners<T extends { id: string; addressHash: string | null }>(
  entries: T[],
  count: number,
  allowMultipleWinnersPerAddress: boolean,
  previouslySelectedAddresses: string[] = [],
) {
  const shuffled = pickRandom(entries, entries.length);
  if (allowMultipleWinnersPerAddress) return shuffled.slice(0, count);

  const selected: T[] = [];
  const addresses = new Set(previouslySelectedAddresses);
  for (const entry of shuffled) {
    const identity = entry.addressHash ?? `entry:${entry.id}`;
    if (addresses.has(identity)) continue;
    addresses.add(identity);
    selected.push(entry);
    if (selected.length === count) break;
  }
  return selected;
}
