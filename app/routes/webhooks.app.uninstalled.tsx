import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);
  await prisma.session.deleteMany({ where: { shop } });
  if (session) await prisma.session.deleteMany({ where: { id: session.id } });
  return new Response(null, { status: 200 });
};
