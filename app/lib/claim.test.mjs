import assert from "node:assert/strict";
import test from "node:test";
import {
  canClaimAllocation,
  claimRedirectResponse,
  createClaimToken,
  hashClaimToken,
} from "./claim.server.ts";

const now = new Date("2026-10-05T20:00:00.000Z");
const allocation = {
  customerGid: "gid://shopify/Customer/123",
  deadlineAt: new Date("2026-10-06T20:00:00.000Z"),
  status: "ISSUED",
  raffleStatus: "DRAWN",
  invoiceUrl: "https://shop.example/checkout/draft",
};

test("claim tokens contain 32 random bytes and only expose a SHA-256 hash for storage", () => {
  const first = createClaimToken();
  const second = createClaimToken();
  assert.equal(Buffer.from(first.token, "base64url").length, 32);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.hash, hashClaimToken(first.token));
  assert.notEqual(first.hash, first.token);
  assert.notEqual(first.token, second.token);
  assert.equal(first.hash.length, 64);
});

test("claim rejects a different or missing customer", () => {
  assert.equal(canClaimAllocation(allocation, "gid://shopify/Customer/456", now), false);
  assert.equal(canClaimAllocation(allocation, null, now), false);
});

test("claim rejects expired, purchased, cancelled, incomplete, and cancelled-draw allocations", () => {
  assert.equal(canClaimAllocation({ ...allocation, deadlineAt: now }, allocation.customerGid, now), false);
  assert.equal(canClaimAllocation({ ...allocation, status: "PURCHASED" }, allocation.customerGid, now), false);
  assert.equal(canClaimAllocation({ ...allocation, status: "CANCELLED" }, allocation.customerGid, now), false);
  assert.equal(canClaimAllocation({ ...allocation, raffleStatus: "CANCELLED" }, allocation.customerGid, now), false);
  assert.equal(canClaimAllocation({ ...allocation, invoiceUrl: null }, allocation.customerGid, now), false);
});

test("claim accepts issued or opened allocations only for the winner", () => {
  assert.equal(canClaimAllocation(allocation, allocation.customerGid, now), true);
  assert.equal(canClaimAllocation({ ...allocation, status: "OPENED" }, allocation.customerGid, now), true);
});

test("claim redirect includes no-store and no-referrer headers", () => {
  const response = claimRedirectResponse(allocation.invoiceUrl);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), allocation.invoiceUrl);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
