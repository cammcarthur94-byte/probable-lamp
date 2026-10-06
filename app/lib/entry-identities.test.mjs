import assert from "node:assert/strict";
import test from "node:test";
import {
  hashEntryAddress,
  hashEntryPhone,
  normalizeAddress,
  normalizePhone,
} from "./entry-identities.ts";

test("normalizes international and region-local phone formats to one number", () => {
  assert.equal(normalizePhone("(416) 555-0123", "CA"), "+14165550123");
  assert.equal(normalizePhone("+1 416 555 0123", "CA"), "+14165550123");
  assert.equal(normalizePhone("020 7946 0018", "GB"), "+442079460018");
});

test("rejects missing or implausible phone numbers", () => {
  assert.equal(normalizePhone(null, "US"), null);
  assert.equal(normalizePhone("123", "US"), null);
});

test("normalizes complete shipping addresses without confusing incomplete addresses", () => {
  const first = {
    address1: "123 Main St.",
    address2: "Unit #4",
    city: "Toronto",
    provinceCode: "ON",
    postalCode: "M5V 2T6",
    countryCode: "CA",
  };
  const equivalent = {
    ...first,
    address1: "123 MAIN ST",
    address2: "unit 4",
    postalCode: "m5v2t6",
  };
  assert.equal(normalizeAddress(first), normalizeAddress(equivalent));
  assert.equal(normalizeAddress({ ...first, address2: "Unit 5" }) === normalizeAddress(first), false);
  assert.equal(normalizeAddress({ ...first, postalCode: null }), null);
  assert.equal(normalizeAddress(null), null);
});

test("stores keyed identity hashes rather than normalized phone or address values", () => {
  const phoneA = hashEntryPhone("(416) 555-0123", null, "CA", "secret");
  const phoneB = hashEntryPhone("+1 416 555 0123", null, "CA", "secret");
  assert.equal(phoneA, phoneB);
  assert.notEqual(phoneA, hashEntryPhone("+1 416 555 0123", null, "CA", "other-secret"));

  const address = {
    address1: "123 Main St.",
    address2: null,
    city: "Toronto",
    provinceCode: "ON",
    postalCode: "M5V 2T6",
    countryCode: "CA",
  };
  const hash = hashEntryAddress(address, "secret");
  assert.equal(hash, hashEntryAddress({ ...address, address1: "123 MAIN ST" }, "secret"));
  assert.notEqual(hash, normalizeAddress(address));
});
