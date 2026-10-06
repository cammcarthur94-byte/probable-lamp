import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deleteDraftOrderIfOpen } from "../lib/draft-orders.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const data = payload as { customer?: { email?: string | null; id?: number | null } };
  const email = data.customer?.email?.trim().toLowerCase();
  const customerId = data.customer?.id ? String(data.customer.id) : undefined;
  const identity = [
    ...(email ? [{ email }] : []),
    ...(customerId ? [{ customerId }] : []),
  ];
  if (identity.length) {
    const allocations = await prisma.allocation.findMany({
      where: { entry: { OR: identity }, raffle: { shopDomain: shop } },
      include: { raffle: { select: { shopDomain: true } } },
    });
    for (const allocation of allocations) {
      if (allocation.draftOrderId && !["PURCHASED", "CANCELLED", "EXPIRED"].includes(allocation.status)) {
        await deleteDraftOrderIfOpen(allocation.raffle.shopDomain, allocation.draftOrderId);
      }
    }
    const winners = await prisma.winner.findMany({
      where: { entry: { OR: identity }, raffle: { shopDomain: shop } },
      include: { raffle: { select: { shopDomain: true } } },
    });
    for (const winner of winners) {
      if (!winner.draftOrderDeletedAt) {
        await deleteDraftOrderIfOpen(winner.raffle.shopDomain, winner.draftOrderId);
      }
    }
    await prisma.entry.deleteMany({
      where: { OR: identity, raffle: { shopDomain: shop } },
    });
  }
  return new Response(null, { status: 200 });
};
