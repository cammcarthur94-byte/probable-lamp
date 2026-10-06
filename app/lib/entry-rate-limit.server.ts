import { createEntryProof, getEntryRateLimitBucket } from "./entry-protection";
import prisma from "../db.server";

const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
let lastPrunedAt = 0;

export { createEntryProof };

export async function consumeEntryAttempt(
  shopDomain: string,
  customerId: string,
  now = Date.now(),
) {
  const bucket = getEntryRateLimitBucket(shopDomain, customerId, now);
  const id = `${bucket.customerKey}:${bucket.windowStart.toISOString()}`;
  const record = await prisma.entryRateLimitBucket.upsert({
    where: {
      shopDomain_customerKey_windowStart: {
        shopDomain,
        customerKey: bucket.customerKey,
        windowStart: bucket.windowStart,
      },
    },
    create: {
      id,
      shopDomain,
      customerKey: bucket.customerKey,
      windowStart: bucket.windowStart,
      count: 1,
    },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  if (now - lastPrunedAt >= 60 * 60 * 1000) {
    lastPrunedAt = now;
    await prisma.entryRateLimitBucket.deleteMany({
      where: { windowStart: { lt: new Date(now - RATE_LIMIT_RETENTION_MS) } },
    });
  }

  return record.count > bucket.maxAttempts;
}
