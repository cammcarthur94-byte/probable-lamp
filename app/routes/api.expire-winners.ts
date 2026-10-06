import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  runExpirySweep,
  processAllocationExpiry,
  processRafflePurge,
} from "../lib/expiry.server";
import { drawClosedRaffles } from "../lib/raffle-draw.server";
import { deleteDraftOrderIfOpen } from "../lib/draft-orders.server";
import {
  consumeExpirySweeperSchedule,
  ensureExpirySweeperScheduled,
  verifyQstashRequest,
} from "../lib/qstash.server";

type ExpiryMessage =
  | { kind: "allocation"; allocationId: string }
  | { kind: "draw"; raffleId: string }
  | { kind: "sweep"; scheduledAt: string }
  | { kind: "purge"; raffleId: string; scheduledAt: string };

async function expireLegacyWinners(now: Date) {
  const winners = await prisma.winner.findMany({
    where: { expiresAt: { lte: now }, draftOrderDeletedAt: null },
    include: { raffle: { select: { shopDomain: true } } },
    take: 100,
  });
  const issues: string[] = [];
  let deleted = 0;
  for (const winner of winners) {
    try {
      await deleteDraftOrderIfOpen(winner.raffle.shopDomain, winner.draftOrderId);
      await prisma.winner.update({
        where: { id: winner.id },
        data: { draftOrderDeletedAt: new Date() },
      });
      deleted += 1;
    } catch (error) {
      issues.push(`${winner.id}: ${error instanceof Error ? error.message : "Unknown legacy expiry error."}`);
    }
  }
  return { found: winners.length, deleted, issues };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (
    !process.env.QSTASH_CURRENT_SIGNING_KEY ||
    !process.env.QSTASH_NEXT_SIGNING_KEY
  ) {
    return new Response("QStash signature verification is not configured.", { status: 503 });
  }
  const body = await request.text();
  let verified = false;
  try {
    verified = await verifyQstashRequest(request, body);
  } catch {
    verified = false;
  }
  if (!verified) return new Response("Unauthorized.", { status: 401 });

  let message: ExpiryMessage;
  try {
    message = JSON.parse(body) as ExpiryMessage;
  } catch {
    return new Response("Invalid expiry message.", { status: 400 });
  }

  if (message.kind === "allocation" && typeof message.allocationId === "string") {
    const result = await processAllocationExpiry(message.allocationId);
    return Response.json(result);
  }
  if (message.kind === "draw" && typeof message.raffleId === "string") {
    try {
      return Response.json(await drawClosedRaffles(new Date(), message.raffleId));
    } finally {
      await ensureExpirySweeperScheduled();
    }
  }
  if (
    message.kind === "purge" &&
    typeof message.raffleId === "string" &&
    typeof message.scheduledAt === "string"
  ) {
    const scheduledAt = new Date(message.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return new Response("Invalid purge schedule time.", { status: 400 });
    }
    return Response.json(await processRafflePurge(message.raffleId, scheduledAt));
  }
  if (message.kind !== "sweep" || typeof message.scheduledAt !== "string") {
    return new Response("Invalid expiry message.", { status: 400 });
  }
  const scheduledAt = new Date(message.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return new Response("Invalid sweep schedule time.", { status: 400 });
  }
  const consumed = await consumeExpirySweeperSchedule(scheduledAt);
  if (!consumed) {
    await ensureExpirySweeperScheduled();
    return Response.json({ skipped: "sweeper message already consumed" });
  }

  const now = new Date();
  try {
    const [allocations, legacy] = await Promise.all([
      runExpirySweep(now),
      expireLegacyWinners(now),
    ]);
    return Response.json({
      ...allocations,
      legacyWinnersFound: legacy.found,
      legacyDraftsDeleted: legacy.deleted,
      issues: legacy.issues,
    });
  } finally {
    await ensureExpirySweeperScheduled();
  }
};
