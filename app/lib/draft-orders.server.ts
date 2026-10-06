import { unauthenticated } from "../shopify.server";

type DraftOrderQuery = {
  data?: { draftOrder?: { id: string; status: string } | null };
  errors?: Array<{ message: string }>;
};

type DraftOrderDelete = {
  data?: {
    draftOrderDelete?: {
      deletedId?: string | null;
      userErrors: Array<{ message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

function getErrors(result: { errors?: Array<{ message: string }> }) {
  return result.errors?.map((error) => error.message) ?? [];
}

export async function deleteDraftOrderIfOpen(shopDomain: string, draftOrderId: string) {
  const { admin } = await unauthenticated.admin(shopDomain);
  const lookup = await admin.graphql(`#graphql
    query FairdropDraftOrderStatus($id: ID!) {
      draftOrder(id: $id) { id status }
    }`, { variables: { id: draftOrderId } });
  const draftResult = (await lookup.json()) as DraftOrderQuery;
  const lookupErrors = getErrors(draftResult);
  if (!lookup.ok || lookupErrors.length) {
    throw new Error(lookupErrors.join("; ") || "Could not check the draft-order status.");
  }
  const draft = draftResult.data?.draftOrder;
  if (!draft || draft.status === "COMPLETED") return;
  if (draft.status !== "OPEN" && draft.status !== "INVOICE_SENT") {
    throw new Error(`Draft order ${draftOrderId} has unsupported status ${draft.status}.`);
  }

  const response = await admin.graphql(`#graphql
    mutation FairdropDeleteExpiredDraftOrder($id: ID!) {
      draftOrderDelete(input: { id: $id }) { deletedId userErrors { message } }
    }`, { variables: { id: draftOrderId } });
  const result = (await response.json()) as DraftOrderDelete;
  const errors = [
    ...getErrors(result),
    ...(result.data?.draftOrderDelete?.userErrors ?? []).map((error) => error.message),
  ];
  if (!response.ok || errors.length) {
    throw new Error(errors.join("; ") || "Could not delete the expired draft order.");
  }
}
