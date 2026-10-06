import { unauthenticated } from "../shopify.server";

export type RaffleVariant = {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  image: { url: string; altText: string | null } | null;
};

type ProductVariantsResponse = {
  data?: {
    shop?: { currencyCode: string };
    product?: {
      featuredImage?: { url: string; altText: string | null } | null;
      images: {
        nodes: Array<{ url: string; altText: string | null }>;
      };
      options: Array<{ name: string }>;
      variants: {
        nodes: RaffleVariant[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
};

const PRODUCT_VARIANTS_QUERY = `#graphql
  query FairdropRaffleVariants($id: ID!, $after: String) {
    product(id: $id) {
      options { name }
      variants(first: 100, after: $after) {
        nodes {
          id
          title
          price
          availableForSale
          selectedOptions { name value }
          image { url altText }
        }
        pageInfo { hasNextPage endCursor }
      }
      featuredImage { url altText }
      images(first: 1) { nodes { url altText } }
      }
      shop { currencyCode }
  }`;

export async function getRaffleProductVariants(shopDomain: string, productId: string) {
  const { admin } = await unauthenticated.admin(shopDomain);
  const variants: RaffleVariant[] = [];
  let optionNames: string[] = [];
  let currencyCode = "";
  let image: { url: string; altText: string | null } | null = null;
  let after: string | null = null;

  do {
    const response = await admin.graphql(PRODUCT_VARIANTS_QUERY, {
      variables: { id: productId, after },
    });
    const result = (await response.json()) as ProductVariantsResponse;
    if (!response.ok || result.errors?.length) {
      const details = result.errors?.map((error) => error.message).join("; ");
      throw new Error(details || `Could not load raffle product options (${response.status}).`);
    }
    const product = result.data?.product;
    if (!product) throw new Error("The raffle product is no longer available.");
    optionNames = product.options.map((option) => option.name);
    currencyCode = result.data?.shop?.currencyCode ?? currencyCode;
    image = product.featuredImage ?? product.images.nodes[0] ?? image;
    variants.push(...product.variants.nodes);
    after = product.variants.pageInfo.hasNextPage
      ? product.variants.pageInfo.endCursor
      : null;
    if (product.variants.pageInfo.hasNextPage && !after) {
      throw new Error("Shopify did not provide the next raffle variant page.");
    }
  } while (after);

  return {
    optionNames,
    variants: variants.filter((variant) => variant.availableForSale),
    currencyCode,
    productImageFallback: image?.url ?? variants.find((variant) => variant.image)?.image?.url ?? null,
    productImageAlt: image?.altText ?? variants.find((variant) => variant.image)?.image?.altText ?? null,
  };
}
