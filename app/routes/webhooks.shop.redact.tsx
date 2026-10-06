import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await prisma.session.deleteMany({ where: { shop } });
  await prisma.webhookEvent.deleteMany({ where: { shopDomain: shop } });
  await prisma.shop.deleteMany({ where: { domain: shop } });
  return new Response(null, { status: 200 });
};
