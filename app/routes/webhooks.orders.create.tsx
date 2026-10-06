import type { ActionFunctionArgs } from "react-router";
import {
  handleRaffleOrder,
  hasWebhookBeenProcessed,
  recordWebhookProcessed,
  type OrderWebhookPayload,
} from "../lib/order-webhooks.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload, admin } = await authenticate.webhook(request);
  if (await hasWebhookBeenProcessed(webhookId)) return new Response(null, { status: 200 });
  if (!admin) throw new Response("Shop is not authenticated for order verification.", { status: 503 });

  const order = payload as OrderWebhookPayload;
  const result = await handleRaffleOrder(admin, shop, order, "created");
  await recordWebhookProcessed({
    webhookId,
    shopDomain: shop,
    topic: String(topic),
    resourceGid: result.resourceGid,
  });
  return Response.json(result);
};
