import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { parseEligibilityRules } from "../lib/eligibility";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");
  const productId = params.productId;
  if (!shopDomain || !productId || !/^\d+$/.test(productId)) {
    return Response.json({ error: "Choose a valid raffle product." }, { status: 400 });
  }

  const raffles = await prisma.raffle.findMany({
    where: {
      shopDomain,
      productId: `gid://shopify/Product/${productId}`,
      status: "ACTIVE",
    },
    select: {
      handle: true,
      title: true,
      description: true,
      productTitle: true,
      productImageUrl: true,
      rules: true,
      startsAt: true,
      closesAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();

  return Response.json(
    {
      raffles: raffles.map((raffle) => ({
        ...raffle,
        rules: parseEligibilityRules(raffle.rules),
        entryState:
          raffle.closesAt <= now
            ? "closed"
            : raffle.startsAt > now
              ? "scheduled"
              : "open",
      })),
      customerSignedIn: Boolean(url.searchParams.get("logged_in_customer_id")),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};
