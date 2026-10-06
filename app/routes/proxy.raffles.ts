import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { parseEligibilityRules } from "../lib/eligibility";
import { createEntryProof } from "../lib/entry-rate-limit.server";
import { getRaffleProductVariants } from "../lib/shopify-product.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop");
    if (!shopDomain) {
      return Response.json({ error: "Unable to identify this store." }, { status: 400 });
    }

    const now = new Date();
    const raffles = await prisma.raffle.findMany({
      where: {
        shopDomain,
        status: "ACTIVE",
        startsAt: { lte: now },
        closesAt: { gt: now },
      },
      select: {
        handle: true,
        title: true,
        description: true,
        productId: true,
        productTitle: true,
        productImageUrl: true,
        rules: true,
        startsAt: true,
        closesAt: true,
      },
      orderBy: { closesAt: "asc" },
    });
    const raffleOptions = await Promise.all(raffles.map(async (raffle) => ({
      ...raffle,
      ...await getRaffleProductVariants(shopDomain, raffle.productId),
      rules: parseEligibilityRules(raffle.rules),
      entryProof: createEntryProof(shopDomain, raffle.handle, now.getTime()),
    })));

    return Response.json(
      {
        raffles: raffleOptions,
        customerSignedIn: Boolean(url.searchParams.get("logged_in_customer_id")),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Fairdrop could not load storefront raffle data.", error);
    return Response.json(
      { error: "Raffle details are temporarily unavailable. Please refresh and try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};
