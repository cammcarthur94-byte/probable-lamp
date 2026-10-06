import { createHmac, timingSafeEqual } from "node:crypto";

const PROOF_TTL_MS = 60 * 60 * 1000;
const MIN_SUBMISSION_AGE_MS = 2_000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

function getSecret() {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("SHOPIFY_API_SECRET is required for entry protection.");
  return secret;
}

function signProof(shopDomain: string, handle: string, issuedAt: number, secret: string) {
  return createHmac("sha256", secret)
    .update(`${shopDomain}\n${handle}\n${issuedAt}`)
    .digest("base64url");
}

export function createEntryProof(
  shopDomain: string,
  handle: string,
  now = Date.now(),
  secret = getSecret(),
) {
  const issuedAt = Math.floor(now);
  return `${issuedAt}.${signProof(shopDomain, handle, issuedAt, secret)}`;
}

export function verifyEntryProof(
  proof: string,
  shopDomain: string,
  handle: string,
  now = Date.now(),
  secret = getSecret(),
) {
  const [issuedAtText, signature, extra] = proof.split(".");
  if (!issuedAtText || !signature || extra !== undefined || !/^\d+$/.test(issuedAtText)) {
    return { valid: false as const, reason: "invalid" as const };
  }

  const issuedAt = Number(issuedAtText);
  const expectedSignature = signProof(shopDomain, handle, issuedAt, secret);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected) ||
    issuedAt > now ||
    now - issuedAt > PROOF_TTL_MS
  ) {
    return { valid: false as const, reason: "invalid" as const };
  }
  if (now - issuedAt < MIN_SUBMISSION_AGE_MS) {
    return { valid: false as const, reason: "tooFast" as const };
  }
  return { valid: true as const, reason: null };
}

export function getEntryRateLimitBucket(
  shopDomain: string,
  customerId: string,
  now = Date.now(),
  secret = getSecret(),
) {
  const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;
  const customerKey = createHmac("sha256", secret)
    .update(`${shopDomain}\n${customerId}`)
    .digest("hex");
  return {
    customerKey,
    windowStart: new Date(windowStart),
    maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
  };
}
