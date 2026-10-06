import type { ActionFunctionArgs } from "react-router";
import {
  handleCompletedDraftOrder,
  hasWebhookBeenProcessed,
  recordWebhookProcessed,
} from "../lib/order-webhooks.server";
import { authenticate } from "../shopify.server";

type DraftOrderWebhookPayload = {
  id?: string | number;
  status?: string;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload, admin } = await authenticate.webhook(request);
  if (await hasWebhookBeenProcessed(webhookId)) return new Response(null, { status: 200 });
  if (!admin) throw new Response("Shop is not authenticated for draft-order verification.", { status: 503 });

  const draft = payload as DraftOrderWebhookPayload;
  const result = draft.id && draft.status?.toUpperCase() === "COMPLETED"
    ? await handleCompletedDraftOrder(admin, shop, draft.id)
    : { kind: "ignored" as const, resourceGid: draft.id ? `gid://shopify/DraftOrder/${draft.id}` : null };
  await recordWebhookProcessed({
    webhookId,
    shopDomain: shop,
    topic: String(topic),
    resourceGid: result.resourceGid,
  });
  return Response.json(result);
};
