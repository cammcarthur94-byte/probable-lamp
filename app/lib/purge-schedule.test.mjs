import assert from "node:assert/strict";
import test from "node:test";
import { nextPurgeSchedule, PURGE_RETENTION_DAYS } from "./purge-schedule.ts";

test("completed raffle retention is 30 days", () => {
  assert.equal(PURGE_RETENTION_DAYS, 30);
});

test("purge scheduling stages each delayed message within the QStash horizon", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const purgeAt = new Date(start.getTime() + PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let now = start;
  let steps = 0;

  while (now < purgeAt) {
    const next = nextPurgeSchedule(purgeAt, now);
    assert.ok(next > now);
    assert.ok(next.getTime() - now.getTime() <= 6 * 24 * 60 * 60 * 1000);
    now = next;
    steps += 1;
  }

  assert.equal(now.getTime(), purgeAt.getTime());
  assert.equal(steps, 5);
});
