import { Client, Receiver } from "@upstash/qstash";
import prisma from "../db.server";
import { nextPurgeSchedule, PURGE_MAX_DELAY_MS } from "./purge-schedule";

const SWEEP_STATE_ID = "claim-expiry-sweeper";
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function qstashClient() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("Set QSTASH_TOKEN to enable reliable claim expiry.");
  return new Client({ token, enableTelemetry: false });
}

function expiryEndpoint() {
  const base = process.env.QSTASH_ENDPOINT_URL ?? process.env.SHOPIFY_APP_URL;
  if (!base) throw new Error("Set QSTASH_ENDPOINT_URL or SHOPIFY_APP_URL to publish expiry jobs.");
  const url = new URL("/api/expire-winners", base);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("The QStash expiry endpoint must use HTTPS in production.");
  }
  return url.toString();
}

export function qstashReceiver() {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error("Set both QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY.");
  }
  return new Receiver({ currentSigningKey, nextSigningKey });
}

export function validateQstashConfiguration() {
  qstashClient();
  qstashReceiver();
  expiryEndpoint();
}

export async function verifyQstashRequest(request: Request, body: string) {
  const signature = request.headers.get("Upstash-Signature");
  if (!signature) return false;
  return qstashReceiver().verify({
    signature,
    body,
    url: request.url,
  });
}

async function publishScheduledSweep(scheduledAt: Date) {
  const notBefore = Math.ceil(scheduledAt.getTime() / 1000);
  await qstashClient().publishJSON({
    url: expiryEndpoint(),
    body: { kind: "sweep", scheduledAt: scheduledAt.toISOString() },
    notBefore,
    deduplicationId: `fairdrop-sweep-${scheduledAt.getTime()}`,
    retries: 5,
  });
}

export async function ensureExpirySweeperScheduled(now = new Date()) {
  await prisma.expirySweepState.upsert({
    where: { id: SWEEP_STATE_ID },
    create: { id: SWEEP_STATE_ID },
    update: {},
  });
  const scheduledAt = new Date(now.getTime() + SWEEP_INTERVAL_MS);
  const claim = await prisma.expirySweepState.updateMany({
    where: {
      id: SWEEP_STATE_ID,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    data: { nextRunAt: scheduledAt },
  });
  if (!claim.count) return;
  try {
    await publishScheduledSweep(scheduledAt);
  } catch (error) {
    await prisma.expirySweepState.updateMany({
      where: { id: SWEEP_STATE_ID, nextRunAt: scheduledAt },
      data: { nextRunAt: null },
    });
    throw error;
  }
}

export async function consumeExpirySweeperSchedule(scheduledAt: Date) {
  const consumed = await prisma.expirySweepState.updateMany({
    where: { id: SWEEP_STATE_ID, nextRunAt: scheduledAt },
    data: { nextRunAt: null },
  });
  return consumed.count === 1;
}

export async function scheduleAllocationExpiry(allocationId: string, deadlineAt: Date) {
  await qstashClient().publishJSON({
    url: expiryEndpoint(),
    body: { kind: "allocation", allocationId },
    notBefore: Math.ceil(deadlineAt.getTime() / 1000),
    deduplicationId: `fairdrop-expiry-${allocationId}-${deadlineAt.getTime()}`,
    retries: 5,
  });
  await ensureExpirySweeperScheduled();
}

export async function scheduleRaffleDraw(raffleId: string, closesAt: Date) {
  const now = new Date();
  if (closesAt.getTime() <= now.getTime() + PURGE_MAX_DELAY_MS) {
    await qstashClient().publishJSON({
      url: expiryEndpoint(),
      body: { kind: "draw", raffleId },
      notBefore: Math.ceil(closesAt.getTime() / 1000),
      deduplicationId: `fairdrop-draw-${raffleId}-${closesAt.getTime()}`,
      retries: 5,
    });
  }
  await ensureExpirySweeperScheduled();
}

export async function ensureCompletedRafflePurgeScheduled(raffleId: string, now = new Date()) {
  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: { status: true, purgeAt: true, purgeNextRunAt: true },
  });
  if (raffle?.status !== "COMPLETED" || !raffle.purgeAt) return false;

  const scheduledAt = nextPurgeSchedule(raffle.purgeAt, now);
  const claimed = await prisma.raffle.updateMany({
    where: {
      id: raffleId,
      status: "COMPLETED",
      purgeAt: raffle.purgeAt,
      OR: [
        { purgeNextRunAt: null },
        { purgeNextRunAt: { lte: now } },
      ],
    },
    data: { purgeNextRunAt: scheduledAt },
  });
  if (!claimed.count) return false;
  try {
    await qstashClient().publishJSON({
      url: expiryEndpoint(),
      body: { kind: "purge", raffleId, scheduledAt: scheduledAt.toISOString() },
      notBefore: Math.ceil(scheduledAt.getTime() / 1000),
      deduplicationId: `fairdrop-purge-${raffleId}-${scheduledAt.getTime()}`,
      retries: 5,
    });
    return true;
  } catch (error) {
    await prisma.raffle.updateMany({
      where: { id: raffleId, status: "COMPLETED", purgeNextRunAt: scheduledAt },
      data: { purgeNextRunAt: null },
    });
    throw error;
  }
}

export async function consumeCompletedRafflePurge(raffleId: string, scheduledAt: Date) {
  const consumed = await prisma.raffle.updateMany({
    where: {
      id: raffleId,
      status: "COMPLETED",
      purgeNextRunAt: scheduledAt,
    },
    data: { purgeNextRunAt: null },
  });
  return consumed.count === 1;
}
