import assert from "node:assert/strict";
import test from "node:test";
import { pickRaffleWinners } from "./winner-selection.ts";

const entries = [
  { id: "one", addressHash: "home-a" },
  { id: "two", addressHash: "home-a" },
  { id: "three", addressHash: "home-b" },
  { id: "four", addressHash: null },
  { id: "five", addressHash: null },
];

test("winner selection avoids repeated complete addresses unless configured", () => {
  const winners = pickRaffleWinners(entries, 5, false);
  const addresses = winners.map((entry) => entry.addressHash ?? `entry:${entry.id}`);
  assert.equal(winners.length, 4);
  assert.equal(new Set(addresses).size, winners.length);
});

test("winner selection can allow multiple winners at the same address", () => {
  const winners = pickRaffleWinners(entries, 5, true);
  assert.equal(winners.length, 5);
});

test("winner selection excludes addresses already allocated in an earlier draw", () => {
  const winners = pickRaffleWinners(entries, 5, false, ["home-a", "home-b"]);
  assert.ok(winners.every((entry) => entry.addressHash !== "home-a" && entry.addressHash !== "home-b"));
  assert.equal(winners.length, 2);
});
