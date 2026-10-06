type ShopifyGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type PublicationResult = {
  data?: {
    product?: {
      resourcePublications: {
        nodes: Array<{
          isPublished: boolean;
          publishDate: string;
          publication: { id: string; name: string };
        }>;
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
};

const ONLINE_STORE_PUBLICATION_QUERY = `#graphql
  query FairdropOnlineStorePublication($id: ID!) {
    product(id: $id) {
      resourcePublications(first: 100) {
        nodes {
          isPublished
          publishDate
          publication { id name }
        }
      }
    }
  }`;

export async function getOnlineStorePublication(admin: ShopifyGraphql, productId: string) {
  const response = await admin.graphql(ONLINE_STORE_PUBLICATION_QUERY, {
    variables: { id: productId },
  });
  const result = (await response.json()) as PublicationResult;
  if (!response.ok || result.errors?.length) {
    throw new Error(
      result.errors?.map((error) => error.message).join("; ") ||
      "Could not check the product's Online Store publication.",
    );
  }
  const publications = result.data?.product?.resourcePublications.nodes ?? [];
  return publications.find(({ publication }) => publication.name === "Online Store") ?? null;
}

async function changeOnlineStorePublication(
  admin: ShopifyGraphql,
  productId: string,
  publicationId: string,
  publishDate: Date | null,
  action: "publish" | "unpublish",
) {
  const mutation = action === "publish"
    ? `#graphql
      mutation FairdropRestoreOnlineStoreProduct($id: ID!, $publicationId: ID!, $publishDate: DateTime) {
        publishablePublish(id: $id, input: { publicationId: $publicationId, publishDate: $publishDate }) {
          userErrors { message }
        }
      }`
    : `#graphql
      mutation FairdropRestrictOnlineStoreProduct($id: ID!, $publicationId: ID!) {
        publishableUnpublish(id: $id, input: { publicationId: $publicationId }) {
          userErrors { message }
        }
      }`;
  const variables: Record<string, unknown> = {
    id: productId,
    publicationId,
  };
  if (action === "publish") {
    variables.publishDate = publishDate?.toISOString() ?? null;
  }
  const response = await admin.graphql(mutation, { variables });
  const result = (await response.json()) as {
    data?: Record<string, { userErrors: Array<{ message: string }> } | undefined>;
    errors?: Array<{ message: string }>;
  };
  const payload = result.data?.[
    action === "publish" ? "publishablePublish" : "publishableUnpublish"
  ];
  const errors = [
    ...(result.errors ?? []).map((error) => error.message),
    ...(payload?.userErrors ?? []).map((error) => error.message),
  ];
  if (!response.ok || errors.length || !payload) {
    throw new Error(
      errors.join("; ") ||
      `Shopify could not ${action} the raffle product in the Online Store.`,
    );
  }
}

export function unpublishFromOnlineStore(
  admin: ShopifyGraphql,
  productId: string,
  publicationId: string,
) {
  return changeOnlineStorePublication(admin, productId, publicationId, null, "unpublish");
}

export function publishToOnlineStore(
  admin: ShopifyGraphql,
  productId: string,
  publicationId: string,
  publishDate: Date | null = null,
) {
  return changeOnlineStorePublication(admin, productId, publicationId, publishDate, "publish");
}
