import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import { createPendingAllocation, issuePendingAllocation } from "./allocation-lifecycle.server";
import { resolveExpiredDraft, selectWaitlistEntry } from "./expiry-logic";
import { completeRaffleIfSettled } from "./raffle-completion.server";
import {
  consumeCompletedRafflePurge,
  ensureCompletedRafflePurgeScheduled,
} from "./qstash.server";
import {
  getOnlineStorePublication,
  publishToOnlineStore,
  unpublishFromOnlineStore,
} from "./product-publication.server";
import { getRafflePublicationAction } from "./product-publication-policy";
import { unauthenticated } from "../shopify.server";
import { drawClosedRaffles } from "./raffle-draw.server";

const DRAFT_ORDER_STATE = `#graphql
  query FairdropAllocationDraftState($id: ID!) {
    draftOrder(id: $id) {
      id
      status
      order { id displayFinancialStatus }
    }
  }`;

type DraftStateResponse = {
  data?: {
    draftOrder?: {
      id: string;
      status: string;
      order?: { id: string; displayFinancialStatus: string } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
};

function asOrderStatus(draft: NonNullable<NonNullable<DraftStateResponse["data"]>["draftOrder"]> | null) {
  return draft
    ? {
        exists: true,
        draftStatus: draft.status,
        financialStatus: draft.order?.displayFinancialStatus ?? null,
        orderId: draft.order?.id ?? null,
      }
    : { exists: false, draftStatus: null, financialStatus: null, orderId: null };
}

async function readDraftState(shopDomain: string, draftOrderId: string) {
  const { admin } = await unauthenticated.admin(shopDomain);
  const response = await admin.graphql(DRAFT_ORDER_STATE, {
    variables: { id: draftOrderId },
  });
  const result = (await response.json()) as DraftStateResponse;
  if (!response.ok || result.errors?.length) {
    throw new Error(result.errors?.map((error) => error.message).join("; ") || "Could not verify the draft-order payment state.");
  }
  return { admin, state: asOrderStatus(result.data?.draftOrder ?? null) };
}

async function markPurchased(allocationId: string, leaseToken: string, orderId?: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.allocation.updateMany({
      where: {
        id: allocationId,
        status: "EXPIRING",
        expiryLeaseToken: leaseToken,
      },
      data: {
        status: "PURCHASED",
        purchasedAt: new Date(),
        ...(orderId ? { orderId } : {}),
        expiryLeaseAt: null,
        expiryLeaseToken: null,
      },
    });
    if (!updated.count) return { updated: false, purgeAt: null as Date | null };
    const allocation = await tx.allocation.findUniqueOrThrow({
      where: { id: allocationId },
      select: { raffleId: true },
    });
    await tx.auditLog.create({
      data: {
        raffleId: allocation.raffleId,
        allocationId,
        action: "PAYMENT_CONFIRMED_AT_EXPIRY",
        details: "Shopify reported that the draft order was completed or paid before expiry deletion.",
      },
    });
    return {
      updated: true,
      purgeAt: await completeRaffleIfSettled(tx, allocation.raffleId),
    };
  });
  if (result.purgeAt) {
    const allocation = await prisma.allocation.findUniqueOrThrow({
      where: { id: allocationId },
      select: { raffleId: true },
    });
    await ensureCompletedRafflePurgeScheduled(allocation.raffleId);
  }
  return result;
}

async function expireAndPromote(allocationId: string, leaseToken: string) {
  return prisma.$transaction(async (tx) => {
    const allocation = await tx.allocation.findFirst({
      where: { id: allocationId, status: "EXPIRING", expiryLeaseToken: leaseToken },
      include: {
        entry: { select: { addressHash: true } },
        raffle: { select: { id: true, winnerCount: true, allowMultipleWinnersPerAddress: true, unsoldCount: true, status: true } },
      },
    });
    if (!allocation) return { kind: "lease-lost" as const };

    const expired = await tx.allocation.updateMany({
      where: { id: allocationId, status: "EXPIRING", expiryLeaseToken: leaseToken },
      data: { status: "EXPIRED", expiryLeaseAt: null, expiryLeaseToken: null },
    });
    if (!expired.count) return { kind: "lease-lost" as const };

    await tx.auditLog.create({
      data: {
        raffleId: allocation.raffleId,
        allocationId,
        action: "CLAIM_EXPIRED",
        details: `Unclaimed draft order ${allocation.draftOrderId ?? "(missing)"} was confirmed unpaid and expired.`,
      },
    });

    if (allocation.raffle.status === "CANCELLED" || allocation.raffle.status === "COMPLETED") {
      await tx.raffle.update({
        where: { id: allocation.raffleId },
        data: { unsoldCount: { increment: 1 } },
      });
      const purgeAt = await completeRaffleIfSettled(tx, allocation.raffleId);
      return { kind: "unsold" as const, purgeAt };
    }

    const candidates = await tx.entry.findMany({
      where: {
        raffleId: allocation.raffleId,
        drawRank: { not: null },
        customerId: { not: null },
        winner: null,
      },
      orderBy: [{ drawRank: "asc" }, { id: "asc" }],
      select: { id: true, customerId: true, addressHash: true },
    });
    const priorAllocations = await tx.allocation.findMany({
      where: { raffleId: allocation.raffleId },
      select: { entryId: true, entry: { select: { addressHash: true } } },
    });
    const allocatedAddresses = allocation.raffle.allowMultipleWinnersPerAddress
      ? []
      : priorAllocations.map((item) => item.entry.addressHash).filter((value): value is string => Boolean(value));
    const next = selectWaitlistEntry(
      candidates,
      allocatedAddresses,
      allocation.raffle.allowMultipleWinnersPerAddress,
      priorAllocations.map((item) => item.entryId),
    );

    if (!next?.customerId) {
      await tx.raffle.update({
        where: { id: allocation.raffleId },
        data: { unsoldCount: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          raffleId: allocation.raffleId,
          allocationId,
          action: "UNIT_MARKED_UNSOLD",
          details: "The waitlist is exhausted or remaining entries violate the one-winner-per-address rule.",
        },
      });
      const purgeAt = await completeRaffleIfSettled(tx, allocation.raffleId);
      return { kind: "unsold" as const, purgeAt };
    }

    const raffle = await tx.raffle.findUniqueOrThrow({
      where: { id: allocation.raffleId },
      select: { claimWindowMinutes: true },
    });
    const deadlineAt = new Date(Date.now() + raffle.claimWindowMinutes * 60 * 1000);
    const replacement = await createPendingAllocation(tx, {
      raffleId: allocation.raffleId,
      entryId: next.id,
      customerGid: `gid://shopify/Customer/${next.customerId}`,
      deadlineAt,
    });
    await tx.auditLog.create({
      data: {
        raffleId: allocation.raffleId,
        allocationId: replacement.id,
        action: "WAITLIST_PROMOTED",
        details: `Promoted entry ${next.id} after allocation ${allocationId} expired.`,
      },
    });
    return { kind: "promoted" as const, allocationId: replacement.id };
  });
}

export async function processAllocationExpiry(allocationId: string, now = new Date()) {
  const leaseToken = randomBytes(16).toString("hex");
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  const allocation = await prisma.$transaction(async (tx) => {
    const claimed = await tx.allocation.updateMany({
      where: {
        id: allocationId,
        deadlineAt: { lte: now },
        OR: [
          { status: { in: ["ISSUED", "OPENED"] } },
          { status: "EXPIRING", expiryLeaseAt: { lte: staleBefore } },
        ],
      },
      data: { status: "EXPIRING", expiryLeaseAt: now, expiryLeaseToken: leaseToken },
    });
    if (!claimed.count) return null;
    return tx.allocation.findUnique({
      where: { id: allocationId },
      include: { raffle: { select: { shopDomain: true } } },
    });
  });
  if (!allocation) return { kind: "not-due-or-already-processed" as const };
  if (!allocation || allocation.expiryLeaseToken !== leaseToken) {
    return { kind: "lease-lost" as const };
  }

  try {
    let state = { exists: false, draftStatus: null as string | null, financialStatus: null as string | null, orderId: null as string | null };
    let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"] | null = null;
    if (allocation.draftOrderId) {
      const result = await readDraftState(allocation.raffle.shopDomain, allocation.draftOrderId);
      state = result.state;
      admin = result.admin;
    }
    let outcome = resolveExpiredDraft(state);
    if (outcome === "PURCHASED") {
      return (await markPurchased(allocation.id, leaseToken, state.orderId)).updated
        ? { kind: "purchased" as const }
        : { kind: "lease-lost" as const };
    }
    if (outcome === "DELETE" && allocation.draftOrderId && admin) {
      try {
        const { deleteDraftOrderIfOpen } = await import("./draft-orders.server");
        await deleteDraftOrderIfOpen(allocation.raffle.shopDomain, allocation.draftOrderId);
      } catch (error) {
        const latest = await readDraftState(allocation.raffle.shopDomain, allocation.draftOrderId);
        outcome = resolveExpiredDraft(latest.state);
        if (outcome !== "PURCHASED") throw error;
        return (await markPurchased(allocation.id, leaseToken, latest.state.orderId)).updated
          ? { kind: "purchased" as const }
          : { kind: "lease-lost" as const };
      }
      const latest = await readDraftState(allocation.raffle.shopDomain, allocation.draftOrderId);
      outcome = resolveExpiredDraft(latest.state);
      if (outcome === "PURCHASED") {
        return (await markPurchased(allocation.id, leaseToken, latest.state.orderId)).updated
          ? { kind: "purchased" as const }
          : { kind: "lease-lost" as const };
      }
      if (latest.state.exists) {
        throw new Error(`Shopify still reports draft order ${allocation.draftOrderId} as open after deletion.`);
      }
    }
    const result = await expireAndPromote(allocation.id, leaseToken);
    if (result.kind === "unsold" && result.purgeAt) {
      await ensureCompletedRafflePurgeScheduled(allocation.raffleId);
    }
    if (result.kind === "promoted") {
      await issuePendingAllocation(result.allocationId);
    }
    return result;
  } catch (error) {
    await prisma.allocation.updateMany({
      where: { id: allocation.id, status: "EXPIRING", expiryLeaseToken: leaseToken },
      data: { status: "ISSUED", expiryLeaseAt: null, expiryLeaseToken: null },
    });
    throw error;
  }
}

export async function runExpirySweep(now = new Date()) {
  const automaticDraws = await drawClosedRaffles(now);
  const onlineStoreRestrictions = await reconcileOnlineStoreRaffleProducts(now);
  const pending = await prisma.allocation.findMany({
    where: {
      status: "PENDING",
      createdAt: { lte: new Date(now.getTime() - 60 * 1000) },
      raffle: { status: "DRAWN" },
    },
    select: { id: true },
    take: 50,
  });
  const due = await prisma.allocation.findMany({
    where: {
      deadlineAt: { lte: now },
      OR: [
        { status: { in: ["ISSUED", "OPENED"] } },
        { status: "EXPIRING", expiryLeaseAt: { lte: new Date(now.getTime() - 10 * 60 * 1000) } },
      ],
    },
    select: { id: true },
    take: 100,
  });
  const results = [];
  for (const item of pending) {
    results.push(await issuePendingAllocation(item.id));
  }
  for (const item of due) {
    results.push(await processAllocationExpiry(item.id, now));
  }
  const completed = await prisma.raffle.findMany({
    where: {
      status: "COMPLETED",
      purgeAt: { gt: now },
      OR: [{ purgeNextRunAt: null }, { purgeNextRunAt: { lte: now } }],
    },
    select: { id: true },
    take: 100,
  });
  for (const raffle of completed) {
    await ensureCompletedRafflePurgeScheduled(raffle.id, now);
  }
  const duePurge = await prisma.raffle.findMany({
    where: { status: "COMPLETED", purgeAt: { lte: now } },
    select: { id: true },
    take: 100,
  });
  let purgedRaffles = 0;
  for (const raffle of duePurge) {
    const deleted = await prisma.raffle.deleteMany({
      where: { id: raffle.id, status: "COMPLETED", purgeAt: { lte: now } },
    });
    purgedRaffles += deleted.count;
  }
  return {
    pendingRecovered: pending.length,
    dueProcessed: due.length,
    purgeJobsRefreshed: completed.length,
    purgedRaffles,
    onlineStoreRestrictions,
    automaticDraws,
    results,
  };
}

export async function reconcileOnlineStoreRaffleProducts(now = new Date()) {
  const raffles = await prisma.raffle.findMany({
    where: {
      restrictOnlineStore: true,
      onlineStorePublicationId: { not: null },
      onlineStoreRestoredAt: null,
      OR: [
        { status: { not: "ACTIVE" } },
        { closesAt: { lte: now } },
        { status: "ACTIVE", startsAt: { lte: now } },
      ],
    },
    select: {
      id: true,
      shopDomain: true,
      productId: true,
      status: true,
      startsAt: true,
      closesAt: true,
      onlineStorePublicationId: true,
      onlineStorePublishDate: true,
      onlineStoreWasPublished: true,
      onlineStoreRestrictedAt: true,
    },
    take: 500,
  });
  const outcomes: Array<{ raffleId: string; status: string }> = [];
  const issues: string[] = [];

  for (const raffle of raffles) {
  const publicationAction = getRafflePublicationAction({
    status: raffle.status,
    startsAt: raffle.startsAt,
    closesAt: raffle.closesAt,
    wasPublished: raffle.onlineStoreWasPublished,
    restrictedAt: raffle.onlineStoreRestrictedAt,
  }, now);
  if (publicationAction === "wait") continue;

  try {
    if (publicationAction === "enforce") {
      const { admin } = await unauthenticated.admin(raffle.shopDomain);
      const publication = await getOnlineStorePublication(admin, raffle.productId);
      if (!publication) {
        throw new Error("The Online Store publication no longer exists.");
      }
      if (publication.isPublished) {
        await unpublishFromOnlineStore(
          admin,
          raffle.productId,
          raffle.onlineStorePublicationId!,
        );
        await prisma.raffle.updateMany({
          where: { id: raffle.id, onlineStoreRestoredAt: null },
          data: { onlineStoreRestrictedAt: now },
        });
        outcomes.push({ raffleId: raffle.id, status: "restricted" });
      } else {
        if (raffle.onlineStoreWasPublished && !raffle.onlineStoreRestrictedAt) {
          await prisma.raffle.updateMany({
            where: { id: raffle.id, onlineStoreRestoredAt: null },
            data: { onlineStoreRestrictedAt: now },
          });
        }
        outcomes.push({ raffleId: raffle.id, status: "already-unpublished" });
      }
    } else if (publicationAction === "restore") {
        const { admin } = await unauthenticated.admin(raffle.shopDomain);
        const restoreAt = raffle.onlineStorePublishDate &&
          raffle.onlineStorePublishDate > now
          ? raffle.onlineStorePublishDate
          : null;
        await publishToOnlineStore(
          admin,
          raffle.productId,
          raffle.onlineStorePublicationId!,
          restoreAt,
        );
        await prisma.raffle.updateMany({
          where: { id: raffle.id, onlineStoreRestoredAt: null },
          data: { onlineStoreRestoredAt: now },
        });
        outcomes.push({ raffleId: raffle.id, status: "restored" });
      } else {
        await prisma.raffle.updateMany({
          where: { id: raffle.id, onlineStoreRestoredAt: null },
          data: { onlineStoreRestoredAt: now },
        });
        outcomes.push({ raffleId: raffle.id, status: "unchanged" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown publication error.";
      console.error(`Fairdrop could not synchronize Online Store product for raffle ${raffle.id}.`, error);
      issues.push(`${raffle.id}: ${message}`);
    }
  }
  if (issues.length) {
    throw new Error(`Could not synchronize ${issues.length} raffle product publication(s): ${issues.join("; ")}`);
  }
  return outcomes;
}

export async function processRafflePurge(raffleId: string, scheduledAt: Date, now = new Date()) {
  const consumed = await consumeCompletedRafflePurge(raffleId, scheduledAt);
  if (!consumed) return { kind: "duplicate-or-obsolete" as const };

  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: { status: true, purgeAt: true },
  });
  if (raffle?.status !== "COMPLETED" || !raffle.purgeAt) {
    return { kind: "not-purgeable" as const };
  }
  if (raffle.purgeAt > now) {
    await ensureCompletedRafflePurgeScheduled(raffleId, now);
    return { kind: "rescheduled" as const };
  }
  const deleted = await prisma.raffle.deleteMany({
    where: { id: raffleId, status: "COMPLETED", purgeAt: { lte: now } },
  });
  return deleted.count ? { kind: "purged" as const } : { kind: "duplicate-or-obsolete" as const };
}
