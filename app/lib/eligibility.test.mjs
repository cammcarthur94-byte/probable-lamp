import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateEligibility,
  hashNormalizedEmail,
  normalizeEmail,
} from "./eligibility.ts";

const customer = {
  verifiedEmail: true,
  email: "customer@example.com",
  createdAt: new Date("2020-01-01T00:00:00.000Z"),
  phone: null,
  defaultAddress: { countryCode: "US", phone: null },
};

const context = {
  loggedInCustomerId: "123",
  drawAnnouncedAt: new Date("2026-01-01T00:00:00.000Z"),
  now: new Date("2026-10-05T00:00:00.000Z"),
};

const eligibilityCases = [
  { name: "allows a customer when no optional rules apply", rules: {}, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "requires an account when configured", rules: { requireAccount: true }, context: { loggedInCustomerId: null }, eligible: false, reasonCode: "ACCOUNT_REQUIRED" },
  { name: "does not require an account when disabled", rules: { requireAccount: false }, context: { loggedInCustomerId: null }, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "requires verified email when configured", rules: { requireVerifiedEmail: true }, customer: { verifiedEmail: false }, eligible: false, reasonCode: "EMAIL_UNVERIFIED" },
  { name: "rejects missing email verification state", rules: { requireVerifiedEmail: true }, customer: { verifiedEmail: null }, eligible: false, reasonCode: "EMAIL_UNVERIFIED" },
  { name: "allows a verified customer email", rules: { requireVerifiedEmail: true }, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "allows a listed default-address country", rules: { allowedCountries: ["US", "CA"] }, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "compares country codes case-insensitively", rules: { allowedCountries: ["us"] }, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "rejects a country not in the allowlist", rules: { allowedCountries: ["CA"] }, eligible: false, reasonCode: "COUNTRY_NOT_ALLOWED" },
  { name: "rejects a missing default address", rules: { allowedCountries: ["US"] }, customer: { defaultAddress: null }, eligible: false, reasonCode: "COUNTRY_NOT_ALLOWED" },
  { name: "rejects a null address country", rules: { allowedCountries: ["US"] }, customer: { defaultAddress: { countryCode: null, phone: null } }, eligible: false, reasonCode: "COUNTRY_NOT_ALLOWED" },
  { name: "does not use a mismatched geo-IP country as a deciding check", rules: { allowedCountries: ["US"] }, context: { geoIpCountry: "CA" }, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "rejects accounts younger than the minimum age at announcement", rules: { minAccountAgeDays: 30 }, customer: { createdAt: new Date("2025-12-10T00:00:00.000Z") }, eligible: false, reasonCode: "ACCOUNT_TOO_NEW" },
  { name: "requires age strictly older than the cutoff", rules: { minAccountAgeDays: 30 }, customer: { createdAt: new Date("2025-12-02T00:00:00.000Z") }, eligible: false, reasonCode: "ACCOUNT_TOO_NEW" },
  { name: "allows accounts older than the minimum age", rules: { minAccountAgeDays: 30 }, customer: { createdAt: new Date("2025-11-30T00:00:00.000Z") }, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "rejects missing account creation time when age is required", rules: { minAccountAgeDays: 1 }, customer: { createdAt: null }, eligible: false, reasonCode: "ACCOUNT_TOO_NEW" },
  { name: "requires a phone number when configured", rules: { requirePhone: true }, eligible: false, reasonCode: "PHONE_REQUIRED" },
  { name: "accepts the default-address phone when customer phone is absent", rules: { requirePhone: true }, customer: { defaultAddress: { countryCode: "US", phone: "555-0100" } }, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "accepts the customer phone field", rules: { requirePhone: true }, customer: { phone: "555-0100" }, eligible: true, reasonCode: "ELIGIBLE" },
  { name: "rejects a disposable email domain", rules: {}, customer: { email: "entrant@mailinator.com" }, eligible: false, reasonCode: "DISPOSABLE_EMAIL" },
  { name: "rejects invalid customer email", rules: {}, customer: { email: "not-an-email" }, eligible: false, reasonCode: "INVALID_EMAIL" },
];

for (const scenario of eligibilityCases) {
  test(`eligibility: ${scenario.name}`, () => {
    const result = evaluateEligibility(
      scenario.rules,
      { ...customer, ...scenario.customer },
      { ...context, ...scenario.context },
    );
    assert.equal(result.eligible, scenario.eligible);
    assert.equal(result.reasonCode, scenario.reasonCode);
    assert.ok(result.userMessage.length > 0);
  });
}

const normalizationCases = [
  ["  CUSTOMER@EXAMPLE.COM ", "customer@example.com"],
  ["user+raffle@example.com", "user@example.com"],
  ["First.Last+raffle@Gmail.com", "firstlast@gmail.com"],
  ["First.Last+raffle@Googlemail.com", "firstlast@gmail.com"],
  ["first.last@gmail.com", "firstlast@gmail.com"],
  ["not-an-email", null],
  ["user@example", null],
  ["@example.com", null],
  ["two@@example.com", null],
  ["user@ example.com", null],
];

for (const [email, expected] of normalizationCases) {
  test(`normalizes email ${JSON.stringify(email)}`, () => {
    assert.equal(normalizeEmail(email), expected);
  });
}

test("hashes case and plus-address variants to the same unique key", () => {
  assert.equal(
    hashNormalizedEmail("Customer+raffle@EXAMPLE.COM"),
    hashNormalizedEmail("customer@example.com"),
  );
});

test("hashes Gmail dot variants and Googlemail aliases to the same unique key", () => {
  assert.equal(
    hashNormalizedEmail("First.Last+raffle@googlemail.com"),
    hashNormalizedEmail("firstlast@gmail.com"),
  );
});
