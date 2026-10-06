import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const data = payload as { customer?: { email?: string | null; id?: number | null } };
  const email = data.customer?.email?.trim().toLowerCase();
  const customerId = data.customer?.id ? String(data.customer.id) : undefined;
  const identity = [
    ...(email ? [{ email }] : []),
    ...(customerId ? [{ customerId }] : []),
  ];
  const entries = identity.length
    ? await prisma.entry.findMany({
        where: { OR: identity, raffle: { shopDomain: shop } },
        select: {
          name: true,
          email: true,
          createdAt: true,
          raffle: { select: { title: true } },
          winner: { select: { createdAt: true, expiresAt: true, emailSentAt: true } },
        },
      })
    : [];
  return Response.json({ customerId, entries });
};
