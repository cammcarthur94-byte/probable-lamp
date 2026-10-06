import assert from "node:assert/strict";
import test from "node:test";
import {
  claimExpiryLease,
  resolveExpiredDraft,
  selectWaitlistEntry,
} from "./expiry-logic.ts";

test("expiry chain promotes ranked entrants until the third entrant buys", () => {
  const waitlist = [
    { id: "winner-1", addressHash: null },
    { id: "winner-2", addressHash: null },
    { id: "winner-3", addressHash: null },
  ];
  const allocated = ["winner-1"];
  let next = selectWaitlistEntry(waitlist, [], true, allocated);
  allocated.push(next.id);
  assert.equal(next.id, "winner-2");
  next = selectWaitlistEntry(waitlist, [], true, allocated);
  allocated.push(next.id);
  assert.equal(next.id, "winner-3");
  assert.equal(resolveExpiredDraft({ exists: true, draftStatus: "COMPLETED", financialStatus: "PAID" }), "PURCHASED");
  assert.equal(selectWaitlistEntry(waitlist, [], true, allocated), null);
});

test("two concurrent expiry workers acquire one allocation lease and promote once", async () => {
  let lease = null;
  const candidates = [
    { id: "winner-1", addressHash: null },
    { id: "winner-2", addressHash: null },
    { id: "winner-3", addressHash: null },
  ];
  const allocatedEntryIds = new Set(["winner-1"]);
  const promoted = [];
  const claim = async (token) => {
    if (lease) return false;
    lease = token;
    return true;
  };
  const run = async (token) => {
    if (await claimExpiryLease(claim, token)) {
      const next = selectWaitlistEntry(candidates, [], true, [...allocatedEntryIds]);
      if (next) {
        allocatedEntryIds.add(next.id);
        promoted.push(next.id);
      }
    }
  };
  await Promise.all([run("worker-a"), run("worker-b")]);
  assert.deepEqual(promoted, ["winner-2"]);
  assert.equal(allocatedEntryIds.has("winner-3"), false);
});

test("an entrant with any prior allocation cannot be promoted again", () => {
  const entries = [
    { id: "already-won", addressHash: "home-a" },
    { id: "new-entry", addressHash: "home-a" },
    { id: "next-entry", addressHash: "home-b" },
  ];
  assert.equal(
    selectWaitlistEntry(entries, [], true, ["already-won"])?.id,
    "new-entry",
  );
});

test("payment confirmed before draft deletion wins the exact-deadline race", () => {
  assert.equal(
    resolveExpiredDraft({ exists: true, draftStatus: "OPEN", financialStatus: "PAID" }),
    "PURCHASED",
  );
  assert.equal(
    resolveExpiredDraft({ exists: true, draftStatus: "OPEN", financialStatus: "PENDING" }),
    "DELETE",
  );
});
