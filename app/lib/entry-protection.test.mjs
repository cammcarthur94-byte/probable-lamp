import assert from "node:assert/strict";
import test from "node:test";
import {
  createEntryProof,
  getEntryRateLimitBucket,
  verifyEntryProof,
} from "./entry-protection.ts";

const secret = "unit-test-secret";
const issuedAt = 1_800_000_000_000;

test("entry proof accepts a valid proof after the minimum completion time", () => {
  const proof = createEntryProof("shop.example", "summer-raffle", issuedAt, secret);
  assert.deepEqual(
    verifyEntryProof(proof, "shop.example", "summer-raffle", issuedAt + 2_000, secret),
    { valid: true, reason: null },
  );
});

test("entry proof rejects tampered raffle and shop values", () => {
  const proof = createEntryProof("shop.example", "summer-raffle", issuedAt, secret);
  assert.equal(verifyEntryProof(proof, "other.example", "summer-raffle", issuedAt + 2_000, secret).valid, false);
  assert.equal(verifyEntryProof(proof, "shop.example", "other-raffle", issuedAt + 2_000, secret).valid, false);
});

test("entry proof rejects malformed, expired, future, and too-fast submissions", () => {
  const proof = createEntryProof("shop.example", "summer-raffle", issuedAt, secret);
  assert.equal(verifyEntryProof("not-a-proof", "shop.example", "summer-raffle", issuedAt + 2_000, secret).valid, false);
  assert.equal(verifyEntryProof(proof, "shop.example", "summer-raffle", issuedAt + 60 * 60 * 1_000 + 1, secret).valid, false);
  assert.equal(verifyEntryProof(proof, "shop.example", "summer-raffle", issuedAt - 1, secret).valid, false);
  assert.deepEqual(
    verifyEntryProof(proof, "shop.example", "summer-raffle", issuedAt + 1_999, secret),
    { valid: false, reason: "tooFast" },
  );
});

test("entry rate-limit buckets are stable within a window and private to shop/customer", () => {
  const first = getEntryRateLimitBucket("shop.example", "customer-1", issuedAt, secret);
  const sameWindow = getEntryRateLimitBucket("shop.example", "customer-1", issuedAt + 1_000, secret);
  const nextWindow = getEntryRateLimitBucket("shop.example", "customer-1", issuedAt + 10 * 60 * 1_000, secret);
  const otherShop = getEntryRateLimitBucket("other.example", "customer-1", issuedAt, secret);
  assert.deepEqual(first, sameWindow);
  assert.notEqual(first.windowStart.getTime(), nextWindow.windowStart.getTime());
  assert.notEqual(first.customerKey, otherShop.customerKey);
  assert.equal(first.maxAttempts, 5);
});
