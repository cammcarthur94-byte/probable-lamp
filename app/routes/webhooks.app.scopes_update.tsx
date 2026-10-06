import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, session, topic } = await authenticate.webhook(request);
  const current = payload as { current?: string[] };
  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { scope: current.current?.join(",") ?? "" },
    });
  }
  console.info(`Updated Shopify access scopes for ${shop} (${topic}).`);
  return new Response(null, { status: 200 });
};
