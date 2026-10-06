import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import { createPendingAllocation, issuePendingAllocation } from "./allocation-lifecycle.server";
import { pickRandom, pickRaffleWinners } from "./winner-selection";
import { completeRaffleIfSettled } from "./raffle-completion.server";
import { ensureCompletedRafflePurgeScheduled } from "./qstash.server";
import { unauthenticated } from "../shopify.server";
import { sendRaffleOutcomeEmail } from "./mailer.server";

const CREATE_RETENTION_DISCOUNT = `#graphql
  mutation FairdropRetentionDiscount($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

const FIND_RETENTION_DISCOUNT = `#graphql
  query FairdropFindRetentionDiscount($code: String!) {
    codeDiscountNodeByCode(code: $code) { id }
  }`;

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

async function ensureRetentionDiscount(
  admin: AdminGraphql,
  input: {
    code: string;
    raffleId: string;
    customerId: string;
    type: string | null;
    value: number | null;
    expiryDays: number | null;
    closesAt: Date;
    now: Date;
  },
) {
  const existingResponse = await admin.graphql(FIND_RETENTION_DISCOUNT, {
    variables: { code: input.code },
  });
  const existingResult = (await existingResponse.json()) as {
    data?: { codeDiscountNodeByCode?: { id: string } | null };
    errors?: Array<{ message: string }>;
  };
  if (!existingResponse.ok || existingResult.errors?.length) {
    throw new Error(existingResult.errors?.map((error) => error.message).join("; ") || "Could not check the retention coupon.");
  }
  if (existingResult.data?.codeDiscountNodeByCode?.id) return;

  if (!input.type || !input.value || !input.expiryDays) {
    throw new Error("The raffle retention coupon settings are incomplete.");
  }
  const customerGets = input.type === "PERCENTAGE"
    ? { value: { percentage: input.value / 100 }, items: { all: true }, appliesOnOneTimePurchase: true }
    : {
        value: { discountAmount: { amount: input.value.toFixed(2), appliesOnEachItem: false } },
        items: { all: true },
        appliesOnOneTimePurchase: true,
      };
  const response = await admin.graphql(CREATE_RETENTION_DISCOUNT, {
    variables: {
      input: {
        title: `Fairdrop raffle ${input.raffleId} thank-you`,
        code: input.code,
        startsAt: input.now.toISOString(),
        endsAt: new Date(input.closesAt.getTime() + input.expiryDays * 24 * 60 * 60 * 1000).toISOString(),
        context: { customers: { add: [`gid://shopify/Customer/${input.customerId}`] } },
        customerGets,
        usageLimit: 1,
        appliesOncePerCustomer: true,
      },
    },
  });
  const result = (await response.json()) as {
    data?: { discountCodeBasicCreate?: { codeDiscountNode?: { id: string } | null; userErrors: Array<{ message: string }> } };
    errors?: Array<{ message: string }>;
  };
  const messages = [
    ...(result.errors ?? []).map((error) => error.message),
    ...(result.data?.discountCodeBasicCreate?.userErrors ?? []).map((error) => error.message),
  ];
  if (!response.ok || messages.length || !result.data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
    const afterFailure = await admin.graphql(FIND_RETENTION_DISCOUNT, {
      variables: { code: input.code },
    });
    const existing = (await afterFailure.json()) as { data?: { codeDiscountNodeByCode?: { id: string } | null } };
    if (afterFailure.ok && existing.data?.codeDiscountNodeByCode?.id) return;
    throw new Error(messages.join("; ") || "Shopify could not create the retention coupon.");
  }
}

function makeRetentionCode() {
  return `FAIR${randomBytes(8).toString("hex").toUpperCase()}`;
}

function formatCouponDescription(
  raffle: { retentionCouponType: string | null; retentionCouponValue: number | null; retentionCouponExpiryDays: number | null },
) {
  const value = raffle.retentionCouponValue;
  const discount = raffle.retentionCouponType === "PERCENTAGE"
    ? `${value}% off`
    : `${value?.toFixed(2)} off in your store currency`;
  return `Use this one-time coupon for ${discount} your next order. It expires ${raffle.retentionCouponExpiryDays} days after the raffle closes.`;
}

async function sendNonWinnerNotifications(raffleId: string, now: Date) {
  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    include: { shop: true },
  });
  if (!raffle || !["DRAWN", "COMPLETED"].includes(raffle.status)) {
    return { sent: 0, failed: 0 };
  }
  const entries = await prisma.entry.findMany({
    where: { raffleId, allocation: null, outcomeEmailSentAt: null },
    orderBy: { id: "asc" },
    take: 100,
  });
  const followups = await prisma.entry.findMany({
    where: {
      raffleId,
      allocation: null,
      outcomeEmailSentAt: { not: null },
      couponEmailSentAt: null,
      retentionCouponCode: { not: null },
    },
    orderBy: { id: "asc" },
    take: Math.max(0, 100 - entries.length),
  });
  const { admin } = await unauthenticated.admin(raffle.shopDomain);
  let sent = 0;
  let failed = 0;

  for (const entry of [...entries, ...followups]) {
    try {
      let code = entry.retentionCouponCode;
      let couponError: string | null = null;
      if (raffle.retentionCouponEnabled && !code) {
        code = makeRetentionCode();
        const saved = await prisma.entry.updateMany({
          where: { id: entry.id, retentionCouponCode: null },
          data: { retentionCouponCode: code },
        });
        if (!saved.count) {
          code = (await prisma.entry.findUniqueOrThrow({
            where: { id: entry.id },
            select: { retentionCouponCode: true },
          })).retentionCouponCode;
        }
      }
      if (raffle.retentionCouponEnabled && code) {
        try {
          await ensureRetentionDiscount(admin, {
            code,
            raffleId,
            customerId: entry.customerId ?? "",
            type: raffle.retentionCouponType,
            value: raffle.retentionCouponValue,
            expiryDays: raffle.retentionCouponExpiryDays,
            closesAt: raffle.closesAt,
            now,
          });
        } catch (error) {
          couponError = error instanceof Error ? error.message : "Shopify could not create the coupon.";
        }
      }

      const firstNotification = !entry.outcomeEmailSentAt;
      const couponReady = raffle.retentionCouponEnabled && code && !couponError;
      if (firstNotification || (couponReady && !entry.couponEmailSentAt)) {
        await sendRaffleOutcomeEmail({
          to: entry.email,
          entrantName: entry.name,
          storeName: raffle.shop.name ?? raffle.shopDomain,
          replyTo: raffle.shop.emailReplyTo,
          raffleTitle: raffle.title,
          productTitle: raffle.productTitle,
          couponCode: couponReady ? code : null,
          couponDescription: couponReady ? formatCouponDescription(raffle) : null,
          couponOnly: !firstNotification,
          idempotencyKey: `fairdrop-${firstNotification ? "outcome" : "coupon"}-${entry.id}`,
        });
      }

      await prisma.entry.update({
        where: { id: entry.id },
        data: {
          ...(firstNotification ? { outcomeEmailSentAt: now } : {}),
          ...(couponReady ? { couponEmailSentAt: now } : {}),
          outcomeEmailError: couponError,
        },
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Entrant notification failed.";
      await prisma.entry.update({
        where: { id: entry.id },
        data: { outcomeEmailError: message },
      });
      console.error(`Fairdrop could not notify raffle entrant ${entry.id}.`, error);
    }
  }
  return { sent, failed };
}

export async function drawClosedRaffles(now = new Date(), raffleId?: string) {
  const raffles = await prisma.raffle.findMany({
    where: {
      ...(raffleId ? { id: raffleId } : {}),
      status: "ACTIVE",
      startsAt: { lte: now },
      closesAt: { lte: now },
    },
    select: {
      id: true,
      winnerCount: true,
      claimWindowMinutes: true,
      allowMultipleWinnersPerAddress: true,
    },
    orderBy: { closesAt: "asc" },
    take: 50,
  });
  const results: Array<{ raffleId: string; drawn: number; notified: number; failed: number }> = [];

  for (const raffle of raffles) {
    const entries = await prisma.entry.findMany({
      where: { raffleId: raffle.id, winner: null, allocation: null, customerId: { not: null } },
      select: { id: true, customerId: true, addressHash: true },
    });
    const ranked = pickRandom(entries, entries.length);
    const selected = pickRaffleWinners(
      ranked,
      raffle.winnerCount,
      raffle.allowMultipleWinnersPerAddress,
    );
    const deadlineAt = new Date(now.getTime() + raffle.claimWindowMinutes * 60 * 1000);
    const draw = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.raffle.updateMany({
        where: {
          id: raffle.id,
          status: "ACTIVE",
          startsAt: { lte: now },
          closesAt: { lte: now },
        },
        data: { status: "DRAWN" },
      });
      if (!transitioned.count) return { ids: [] as string[], purgeAt: null as Date | null };
      for (let index = 0; index < ranked.length; index += 1) {
        await tx.entry.update({
          where: { id: ranked[index].id },
          data: { drawRank: index + 1 },
        });
      }
      const allocationIds: string[] = [];
      for (const entry of selected) {
        if (!entry.customerId) continue;
        const allocation = await createPendingAllocation(tx, {
          raffleId: raffle.id,
          entryId: entry.id,
          customerGid: `gid://shopify/Customer/${entry.customerId}`,
          deadlineAt,
        });
        allocationIds.push(allocation.id);
      }
      if (allocationIds.length < raffle.winnerCount) {
        await tx.raffle.update({
          where: { id: raffle.id },
          data: { unsoldCount: raffle.winnerCount - allocationIds.length },
        });
      }
      const purgeAt = allocationIds.length
        ? null
        : await completeRaffleIfSettled(tx, raffle.id);
      return { ids: allocationIds, purgeAt };
    });

    for (const allocationId of draw.ids) {
      try {
        await issuePendingAllocation(allocationId);
      } catch (error) {
        console.error(`Fairdrop automatic winner issuance failed for ${allocationId}.`, error);
      }
    }
    if (draw.purgeAt) await ensureCompletedRafflePurgeScheduled(raffle.id);
    const notifications = await sendNonWinnerNotifications(raffle.id, now);
    results.push({
      raffleId: raffle.id,
      drawn: draw.ids.length,
      notified: notifications.sent,
      failed: notifications.failed,
    });
  }

  const notificationRaffles = await prisma.raffle.findMany({
    where: {
      ...(raffleId ? { id: raffleId } : {}),
      status: { in: ["DRAWN", "COMPLETED"] },
      entries: {
        some: {
          allocation: null,
          OR: [
            { outcomeEmailSentAt: null },
            { couponEmailSentAt: null, retentionCouponCode: { not: null } },
          ],
        },
      },
    },
    select: { id: true },
    orderBy: { closesAt: "asc" },
    take: 100,
  });
  for (const raffle of notificationRaffles) {
    if (results.some((result) => result.raffleId === raffle.id)) continue;
    const notifications = await sendNonWinnerNotifications(raffle.id, now);
    if (notifications.sent || notifications.failed) {
      results.push({
        raffleId: raffle.id,
        drawn: 0,
        notified: notifications.sent,
        failed: notifications.failed,
      });
    }
  }
  return results;
}
