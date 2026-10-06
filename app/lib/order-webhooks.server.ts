import prisma from "../db.server";
import { completeRaffleIfSettled } from "./raffle-completion.server";
import { ensureCompletedRafflePurgeScheduled } from "./qstash.server";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type OrderWebhookPayload = {
  id?: string | number;
  status?: string;
  order_id?: string | number | null;
  tags?: string[] | string;
};

type ShopifyOrder = {
  id: string;
  tags: string[];
  customer: { id: string } | null;
  shippingAddress: { countryCode: string | null } | null;
  displayFinancialStatus: string;
  cancelledAt: string | null;
  lineItems: { nodes: Array<{ quantity: number; variant: { id: string } | null }> };
};

type OrderQueryResponse = {
  data?: { order?: ShopifyOrder | null };
  errors?: Array<{ message: string }>;
};

const ORDER_QUERY = `#graphql
  query FairdropOrderEligibility($id: ID!) {
    order(id: $id) {
      id
      tags
      customer { id }
      shippingAddress { countryCode }
      displayFinancialStatus
      cancelledAt
      lineItems(first: 10) {
        nodes { quantity variant { id } }
      }
    }
  }`;

const ORDER_CANCEL = `#graphql
  mutation FairdropCancelIneligibleRaffleOrder(
    $orderId: ID!,
    $reason: OrderCancelReason!,
    $notifyCustomer: Boolean!,
    $refundMethod: OrderCancelRefundMethodInput,
    $restock: Boolean!,
    $staffNote: String
  ) {
    orderCancel(
      orderId: $orderId,
      reason: $reason,
      notifyCustomer: $notifyCustomer,
      refundMethod: $refundMethod,
      restock: $restock,
      staffNote: $staffNote
    ) {
      userErrors { message }
    }
  }`;

const ORDER_CANCELLATION_STATUS = `#graphql
  query FairdropOrderCancellationStatus($orderId: ID!) {
    order(id: $orderId) { cancelledAt }
  }`;

function orderGid(value: string | number) {
  const stringValue = String(value);
  return stringValue.startsWith("gid://") ? stringValue : `gid://shopify/Order/${stringValue}`;
}

function tagsFrom(value: string[] | string | undefined) {
  return Array.isArray(value)
    ? value
    : (value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function allocationIdFromTags(tags: string[]) {
  const tagged = tags.find((tag) => tag.startsWith("allocation:"));
  return tagged?.slice("allocation:".length) ?? null;
}

function countriesFromRules(rules: string) {
  let parsed: { allowedCountries?: unknown };
  try {
    parsed = JSON.parse(rules) as { allowedCountries?: unknown };
  } catch {
    throw new Error("Raffle eligibility rules contain invalid JSON.");
  }
  return Array.isArray(parsed.allowedCountries)
    ? parsed.allowedCountries
        .filter((country): country is string => typeof country === "string")
        .map((country) => country.trim().toUpperCase())
    : [];
}

export async function hasWebhookBeenProcessed(webhookId: string) {
  return Boolean(await prisma.webhookEvent.findUnique({ where: { id: webhookId }, select: { id: true } }));
}

export async function recordWebhookProcessed(input: {
  webhookId: string;
  shopDomain: string;
  topic: string;
  resourceGid: string | null;
}) {
  try {
    await prisma.webhookEvent.create({
      data: {
      id: input.webhookId,
      shopDomain: input.shopDomain,
      topic: input.topic,
      resourceGid: input.resourceGid,
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

export async function readShopifyOrder(admin: AdminGraphql, id: string | number) {
  const idGid = orderGid(id);
  const response = await admin.graphql(ORDER_QUERY, { variables: { id: idGid } });
  const result = (await response.json()) as OrderQueryResponse;
  if (!response.ok || result.errors?.length) {
    throw new Error(result.errors?.map((error) => error.message).join("; ") || `Could not verify Shopify order ${idGid}.`);
  }
  return result.data?.order ?? null;
}

async function findAllocation(shopDomain: string, order: ShopifyOrder) {
  const taggedAllocationId = allocationIdFromTags(order.tags);
  return prisma.allocation.findFirst({
    where: {
      raffle: { shopDomain },
      OR: [
        ...(taggedAllocationId ? [{ id: taggedAllocationId }] : []),
        { orderId: order.id },
      ],
    },
    include: {
      entry: { select: { variantId: true } },
      raffle: { select: { rules: true, productVariantId: true, status: true } },
    },
  });
}

function eligibilityFailure(
  allocation: {
    customerGid: string;
    entry: { variantId: string | null };
    raffle: { rules: string; productVariantId: string; status: string };
  },
  order: ShopifyOrder,
) {
  const expectedCustomerId = allocation.customerGid.split("/").pop();
  const allowedCountries = countriesFromRules(allocation.raffle.rules);
  const shippingCountry = order.shippingAddress?.countryCode?.trim().toUpperCase();
  const correctCustomer = order.customer?.id.split("/").pop() === expectedCustomerId;
  const correctCountry = !allowedCountries.length ||
    Boolean(shippingCountry && allowedCountries.includes(shippingCountry));
  const expectedVariantId = (
    allocation.entry.variantId ?? allocation.raffle.productVariantId
  ).split("/").pop();
  const correctQuantity =
    order.lineItems.nodes.length === 1 &&
    order.lineItems.nodes[0].quantity === 1 &&
    order.lineItems.nodes[0].variant?.id.split("/").pop() === expectedVariantId;
  return !correctCustomer || !correctCountry || !correctQuantity || allocation.raffle.status === "CANCELLED";
}

async function cancelInvalidOrder(admin: AdminGraphql, order: ShopifyOrder, allocationId: string) {
  const response = await admin.graphql(ORDER_CANCEL, {
    variables: {
      orderId: order.id,
      reason: "OTHER",
      notifyCustomer: true,
      refundMethod: { originalPaymentMethodsRefund: true },
      restock: true,
      staffNote: `Fairdrop raffle allocation ${allocationId} failed winner eligibility verification.`,
    },
  });
  const result = (await response.json()) as {
    errors?: Array<{ message: string }>;
    data?: { orderCancel?: { userErrors: Array<{ message: string }> } };
  };
  const errors = [
    ...(result.errors ?? []).map((error) => error.message),
    ...(result.data?.orderCancel?.userErrors ?? []).map((error) => error.message),
  ];
  if (!response.ok || errors.length) {
    const statusResponse = await admin.graphql(ORDER_CANCELLATION_STATUS, {
      variables: { orderId: order.id },
    });
    const status = (await statusResponse.json()) as {
      data?: { order?: { cancelledAt: string | null } | null };
    };
    if (!statusResponse.ok || !status.data?.order?.cancelledAt) {
      throw new Error(`Could not cancel ineligible raffle order ${order.id}: ${errors.join("; ") || response.statusText}`);
    }
  }
}

export async function handleRaffleOrder(
  admin: AdminGraphql,
  shopDomain: string,
  payload: OrderWebhookPayload,
  mode: "created" | "paid" | "completed",
) {
  if (!payload.id) return { kind: "ignored" as const, resourceGid: null };
  const order = await readShopifyOrder(admin, payload.id);
  if (!order) return { kind: "ignored" as const, resourceGid: orderGid(payload.id) };
  const allocation = await findAllocation(shopDomain, order);
  if (!allocation) return { kind: "ignored" as const, resourceGid: order.id };
  if (allocation.status === "PURCHASED" || allocation.status === "CANCELLED") {
    return { kind: "already-processed" as const, resourceGid: order.id };
  }
  if (eligibilityFailure(allocation, order) || order.cancelledAt) {
    await cancelInvalidOrder(admin, order, allocation.id);
    const purgeAt = await prisma.$transaction(async (tx) => {
      const changed = await tx.allocation.updateMany({
        where: {
          id: allocation.id,
          status: { in: ["PENDING", "ISSUED", "OPENED", "EXPIRING"] },
        },
        data: { status: "CANCELLED", cancelledAt: new Date(), orderId: order.id },
      });
      if (changed.count) {
        await tx.auditLog.create({
          data: {
            raffleId: allocation.raffleId,
            allocationId: allocation.id,
            action: "INELIGIBLE_ORDER_CANCELLED",
            details: "Shopify order failed customer, region, quantity, or raffle status checks.",
          },
        });
        await tx.raffle.update({
          where: { id: allocation.raffleId },
          data: { unsoldCount: { increment: 1 } },
        });
        return completeRaffleIfSettled(tx, allocation.raffleId);
      }
      return null;
    });
    if (purgeAt) await ensureCompletedRafflePurgeScheduled(allocation.raffleId);
    return { kind: "cancelled", resourceGid: order.id };
  }

  if (mode === "created") {
    await prisma.allocation.updateMany({
      where: {
        id: allocation.id,
        status: { in: ["PENDING", "ISSUED", "OPENED", "EXPIRING"] },
      },
      data: { orderId: order.id },
    });
    return { kind: "verified", resourceGid: order.id };
  }

  if (mode === "paid" && order.displayFinancialStatus !== "PAID") {
    return { kind: "payment-not-settled", resourceGid: order.id };
  }
  const purgeAt = await prisma.$transaction(async (tx) => {
    const changed = await tx.allocation.updateMany({
      where: {
        id: allocation.id,
        status: { in: ["PENDING", "ISSUED", "OPENED", "EXPIRING"] },
      },
      data: {
        status: "PURCHASED",
        purchasedAt: new Date(),
        orderId: order.id,
        expiryLeaseAt: null,
        expiryLeaseToken: null,
      },
    });
    if (changed.count) {
      await tx.auditLog.create({
        data: {
          raffleId: allocation.raffleId,
          allocationId: allocation.id,
          action: "ORDER_PAID",
          details: `Shopify confirmed paid order ${order.id}.`,
        },
      });
      return completeRaffleIfSettled(tx, allocation.raffleId);
    }
    return null;
  });
  if (purgeAt) await ensureCompletedRafflePurgeScheduled(allocation.raffleId);
  return { kind: "purchased", resourceGid: order.id };
}

export async function handleCompletedDraftOrder(
  admin: AdminGraphql,
  shopDomain: string,
  draftId: string | number,
) {
  const id = String(draftId).startsWith("gid://")
    ? String(draftId)
    : `gid://shopify/DraftOrder/${draftId}`;
  const response = await admin.graphql(`#graphql
    query FairdropCompletedDraftOrder($id: ID!) {
      draftOrder(id: $id) {
        id
        status
        tags
        order { id displayFinancialStatus }
      }
    }`, { variables: { id } });
  const result = (await response.json()) as {
    data?: {
      draftOrder?: {
        id: string;
        status: string;
        tags: string[];
        order?: { id: string; displayFinancialStatus: string } | null;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || result.errors?.length) {
    throw new Error(result.errors?.map((error) => error.message).join("; ") || "Could not verify completed draft order.");
  }
  const draft = result.data?.draftOrder;
  if (!draft || draft.status !== "COMPLETED" || !draft.order) {
    return { kind: "ignored" as const, resourceGid: id };
  }
  const allocationId = allocationIdFromTags(draft.tags);
  if (!allocationId) return { kind: "ignored" as const, resourceGid: id };
  const allocation = await prisma.allocation.findFirst({
    where: { id: allocationId, raffle: { shopDomain } },
    select: { id: true, status: true },
  });
  if (!allocation || ["PURCHASED", "CANCELLED", "EXPIRED"].includes(allocation.status)) {
    return { kind: "already-processed" as const, resourceGid: id };
  }
  const outcome = await handleRaffleOrder(admin, shopDomain, { id: draft.order.id }, "completed");
  return { ...outcome, resourceGid: id };
}

export function normalizeOrderGid(id: string | number) {
  return orderGid(id);
}

export function getWebhookPayloadTags(payload: OrderWebhookPayload) {
  return tagsFrom(payload.tags);
}
