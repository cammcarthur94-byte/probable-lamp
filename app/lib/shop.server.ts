import prisma from "../db.server";

type ShopQuery = {
  data?: {
    shop?: {
      name: string;
      primaryDomain?: { url: string } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
};

export async function syncShop(
  session: { shop: string },
  admin: { graphql: (query: string) => Promise<Response> },
) {
  const response = await admin.graphql(
    `#graphql
      query FairdropShopDetails {
        shop {
          name
          primaryDomain { url }
        }
      }`,
  );
  const result = (await response.json()) as ShopQuery;
  if (!response.ok || result.errors?.length || !result.data?.shop) {
    throw new Error(
      result.errors?.map((error) => error.message).join("; ") ||
        "Shopify did not return shop details.",
    );
  }
  const shop = result.data.shop;
  return prisma.shop.upsert({
    where: { domain: session.shop },
    create: {
      domain: session.shop,
      name: shop.name,
      storefrontUrl: shop.primaryDomain?.url ?? `https://${session.shop}`,
    },
    update: {
      name: shop.name,
      storefrontUrl: shop.primaryDomain?.url ?? `https://${session.shop}`,
    },
  });
}
