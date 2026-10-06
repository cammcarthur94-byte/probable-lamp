import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { createClaimToken } from "./claim.server";
import { buildWinnerClaimEmailContent, sendWinnerClaimEmail } from "./mailer.server";
import {
  ensureExpirySweeperScheduled,
  scheduleAllocationExpiry,
  validateQstashConfiguration,
} from "./qstash.server";
import { unauthenticated } from "../shopify.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type PendingAllocation = Prisma.AllocationGetPayload<{
  include: {
    entry: true;
    raffle: { include: { shop: true } };
  };
}>;

type DraftOrderCreateResult = {
  data?: {
    draftOrderCreate?: {
      draftOrder?: { id: string; invoiceUrl: string } | null;
      userErrors: Array<{ message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const DRAFT_ORDER_CREATE = `#graphql
  mutation FairdropDraftOrder($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id invoiceUrl }
      userErrors { field message }
    }
  }`;

const DRAFT_ORDER_FIND_BY_ALLOCATION_TAG = `#graphql
  query FairdropFindAllocationDraft($query: String!) {
    draftOrders(first: 10, query: $query) {
      nodes { id invoiceUrl status }
    }
  }`;

function getErrors(result: DraftOrderCreateResult) {
  return [
    ...(result.errors ?? []).map((error) => error.message),
    ...(result.data?.draftOrderCreate?.userErrors ?? []).map((error) => error.message),
  ];
}

function claimUrl(storefrontUrl: string, token: string) {
  return new URL(`/apps/fairdrop/claim/${encodeURIComponent(token)}`, storefrontUrl).toString();
}

async function findExistingDraft(admin: AdminGraphql, allocationId: string) {
  const response = await admin.graphql(DRAFT_ORDER_FIND_BY_ALLOCATION_TAG, {
    variables: { query: `tag:allocation:${allocationId}` },
  });
  const result = (await response.json()) as {
    data?: { draftOrders?: { nodes: Array<{ id: string; invoiceUrl: string; status: string }> } };
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || result.errors?.length) {
    throw new Error(result.errors?.map((error) => error.message).join("; ") || "Could not reconcile the draft order.");
  }
  return result.data?.draftOrders?.nodes.find(
    (draft) => draft.status === "OPEN" || draft.status === "INVOICE_SENT",
  ) ?? null;
}

async function createDraft(admin: AdminGraphql, allocation: PendingAllocation) {
  const existing = await findExistingDraft(admin, allocation.id);
  if (existing) return { id: existing.id, invoiceUrl: existing.invoiceUrl };
  const response = await admin.graphql(DRAFT_ORDER_CREATE, {
    variables: {
      input: {
        customerId: allocation.customerGid,
        email: allocation.entry.email,
        useCustomerDefaultAddress: true,
        lineItems: [{
          variantId: allocation.entry.variantId ?? allocation.raffle.productVariantId,
          quantity: 1,
        }],
        acceptAutomaticDiscounts: false,
        allowDiscountCodesInCheckout: false,
        note: `Fairdrop raffle:${allocation.raffleId}`,
        tags: [`raffle:${allocation.raffleId}`, `allocation:${allocation.id}`],
        reserveInventoryUntil: allocation.deadlineAt.toISOString(),
      },
    },
  });
  const result = (await response.json()) as DraftOrderCreateResult;
  const draft = result.data?.draftOrderCreate?.draftOrder;
  const errors = getErrors(result);
  if (!response.ok || errors.length || !draft?.id || !draft.invoiceUrl) {
    const existing = await findExistingDraft(admin, allocation.id);
    if (existing) return { id: existing.id, invoiceUrl: existing.invoiceUrl };
    throw new Error(errors.join("; ") || "Shopify could not create the draft order.");
  }
  return draft;
}

export async function createPendingAllocation(
  tx: Prisma.TransactionClient,
  input: {
    raffleId: string;
    entryId: string;
    customerGid: string;
    deadlineAt: Date;
  },
) {
  const claim = createClaimToken();
  return tx.allocation.create({
    data: {
      raffleId: input.raffleId,
      entryId: input.entryId,
      customerGid: input.customerGid,
      claimTokenHash: claim.hash,
      deadlineAt: input.deadlineAt,
      status: "PENDING",
    },
  });
}

export async function issuePendingAllocation(allocationId: string, adminOverride?: AdminGraphql) {
  const leaseToken = randomBytes(16).toString("hex");
  const now = new Date();
  const staleLease = new Date(now.getTime() - 10 * 60 * 1000);
  const claimed = await prisma.allocation.updateMany({
    where: {
      id: allocationId,
      status: "PENDING",
      OR: [
        { issuanceLeaseAt: null },
        { issuanceLeaseAt: { lte: staleLease } },
      ],
    },
    data: { issuanceLeaseAt: now, issuanceLeaseToken: leaseToken },
  });
  if (!claimed.count) return { kind: "skipped" as const };

  let allocation = await prisma.allocation.findUnique({
    where: { id: allocationId },
    include: { entry: true, raffle: { include: { shop: true } } },
  });
  if (!allocation) return { kind: "missing" as const };
  let admin = adminOverride;
  if (!admin) admin = (await unauthenticated.admin(allocation.raffle.shopDomain)).admin;

  try {
    const draft = await createDraft(admin, allocation);
    const claim = createClaimToken();
    const updated = await prisma.allocation.updateMany({
      where: { id: allocationId, status: "PENDING", issuanceLeaseToken: leaseToken },
      data: {
        draftOrderId: draft.id,
        invoiceUrl: draft.invoiceUrl,
        claimTokenHash: claim.hash,
        status: "ISSUED",
        notificationError: null,
        issuanceLeaseAt: null,
        issuanceLeaseToken: null,
      },
    });
    if (!updated.count) return { kind: "skipped" as const };
    try {
      await scheduleAllocationExpiry(allocationId, allocation.deadlineAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "QStash could not schedule claim expiry.";
      await prisma.allocation.update({
        where: { id: allocationId },
        data: { notificationError: `Expiry scheduling failed: ${message}` },
      });
      throw error;
    }
    allocation = {
      ...allocation,
      draftOrderId: draft.id,
      invoiceUrl: draft.invoiceUrl,
      claimTokenHash: claim.hash,
      status: "ISSUED",
    };
    try {
      await sendWinnerClaimEmail({
        to: allocation.entry.email,
        winnerName: allocation.entry.name,
        storeName: allocation.raffle.shop.name ?? allocation.raffle.shopDomain,
        replyTo: allocation.raffle.shop.emailReplyTo,
        subjectTemplate: allocation.raffle.shop.emailSubject,
        messageTemplate: allocation.raffle.shop.emailMessage,
        raffleTitle: allocation.raffle.title,
        productTitle: allocation.raffle.productTitle,
        deadlineAt: allocation.deadlineAt,
        timeZone: allocation.entry.timeZone,
        claimUrl: claimUrl(
          allocation.raffle.shop.storefrontUrl ?? `https://${allocation.raffle.shopDomain}`,
          claim.token,
        ),
      });
      await prisma.allocation.update({
        where: { id: allocationId },
        data: { emailSentAt: new Date(), notificationError: null },
      });
      return { kind: "issued" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Winner email delivery failed.";
      await prisma.allocation.update({
        where: { id: allocationId },
        data: { notificationError: message },
      });
      return { kind: "emailFailed" as const, error: message };
    }
  } catch (error) {
    await prisma.allocation.updateMany({
      where: { id: allocationId, status: "PENDING", issuanceLeaseToken: leaseToken },
      data: { issuanceLeaseAt: null, issuanceLeaseToken: null },
    });
    throw error;
  }
}

export async function sendFreshClaim(allocation: PendingAllocation) {
  if (!allocation.draftOrderId || !allocation.invoiceUrl) {
    return issuePendingAllocation(allocation.id);
  }
  const claim = createClaimToken();
  const updated = await prisma.allocation.updateMany({
    where: {
      id: allocation.id,
      status: { in: ["ISSUED", "OPENED"] },
      deadlineAt: { gt: new Date() },
    },
    data: {
      claimTokenHash: claim.hash,
      status: "ISSUED",
      notificationError: null,
    },
  });
  if (!updated.count) throw new Error("This claim is no longer available.");
  await scheduleAllocationExpiry(allocation.id, allocation.deadlineAt);
  await sendWinnerClaimEmail({
    to: allocation.entry.email,
    winnerName: allocation.entry.name,
    storeName: allocation.raffle.shop.name ?? allocation.raffle.shopDomain,
    replyTo: allocation.raffle.shop.emailReplyTo,
    subjectTemplate: allocation.raffle.shop.emailSubject,
    messageTemplate: allocation.raffle.shop.emailMessage,
    raffleTitle: allocation.raffle.title,
    productTitle: allocation.raffle.productTitle,
    deadlineAt: allocation.deadlineAt,
    timeZone: allocation.entry.timeZone,
    claimUrl: claimUrl(
      allocation.raffle.shop.storefrontUrl ?? `https://${allocation.raffle.shopDomain}`,
      claim.token,
    ),
  });
  await prisma.allocation.update({
    where: { id: allocation.id },
    data: { emailSentAt: new Date(), notificationError: null },
  });
  return { kind: "issued" as const };
}

export async function prepareManualWinnerClaim(allocation: PendingAllocation) {
  if (!allocation.draftOrderId || !allocation.invoiceUrl) {
    throw new Error("The winner checkout is still being prepared. Try again shortly.");
  }
  if (
    allocation.deadlineAt <= new Date() ||
    !["ISSUED", "OPENED"].includes(allocation.status)
  ) {
    throw new Error("This winner claim is no longer available.");
  }

  await scheduleAllocationExpiry(allocation.id, allocation.deadlineAt);
  const claim = createClaimToken();
  const updated = await prisma.allocation.updateMany({
    where: {
      id: allocation.id,
      claimTokenHash: allocation.claimTokenHash,
      status: { in: ["ISSUED", "OPENED"] },
      deadlineAt: { gt: new Date() },
    },
    data: {
      claimTokenHash: claim.hash,
      status: "ISSUED",
      openedAt: null,
      emailSentAt: null,
      notificationError: null,
    },
  });
  if (!updated.count) {
    throw new Error("This winner claim changed while you were preparing the email. Refresh and try again.");
  }

  const email = {
    winnerName: allocation.entry.name,
    storeName: allocation.raffle.shop.name ?? allocation.raffle.shopDomain,
    replyTo: allocation.raffle.shop.emailReplyTo,
    subjectTemplate: allocation.raffle.shop.emailSubject,
    messageTemplate: allocation.raffle.shop.emailMessage,
    raffleTitle: allocation.raffle.title,
    productTitle: allocation.raffle.productTitle,
    deadlineAt: allocation.deadlineAt,
    timeZone: allocation.entry.timeZone,
    claimUrl: claimUrl(
      allocation.raffle.shop.storefrontUrl ?? `https://${allocation.raffle.shopDomain}`,
      claim.token,
    ),
  };
  const content = buildWinnerClaimEmailContent(email);
  return {
    allocationId: allocation.id,
    to: allocation.entry.email,
    ...content,
    expiresAt: allocation.deadlineAt.toISOString(),
    warning: "This secure link is shown once. Copy it into your email now; generating another manual email replaces this link.",
  };
}

export async function startExpirySafetySweeper() {
  validateQstashConfiguration();
  await ensureExpirySweeperScheduled();
}
