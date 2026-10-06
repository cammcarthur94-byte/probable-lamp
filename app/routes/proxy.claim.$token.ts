import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  canClaimAllocation,
  claimRedirectResponse,
  hashClaimToken,
  invalidClaimResponse,
} from "../lib/claim.server";
import { authenticate } from "../shopify.server";

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const token = params.token;
  const shopDomain = session?.shop ?? new URL(request.url).searchParams.get("shop");
  if (!token || !shopDomain) return invalidClaimResponse();

  const allocation = await prisma.allocation.findFirst({
    where: {
      claimTokenHash: hashClaimToken(token),
      raffle: { shopDomain },
    },
    include: {
      raffle: {
        select: {
          status: true,
          shop: { select: { storefrontUrl: true } },
        },
      },
    },
  });
  if (!allocation || !allocation.invoiceUrl) return invalidClaimResponse();

  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) {
    const storefrontUrl = allocation.raffle.shop.storefrontUrl ?? `https://${shopDomain}`;
    const claimPath = `/apps/fairdrop/claim/${encodeURIComponent(token)}`;
    const loginUrl = new URL("/account/login", storefrontUrl);
    loginUrl.searchParams.set("return_url", claimPath);
    return new Response(null, {
      status: 302,
      headers: { ...SECURITY_HEADERS, Location: loginUrl.toString() },
    });
  }

  const customerGid = `gid://shopify/Customer/${customerId}`;
  if (!canClaimAllocation(
    {
      customerGid: allocation.customerGid,
      deadlineAt: allocation.deadlineAt,
      status: allocation.status,
      raffleStatus: allocation.raffle.status,
      invoiceUrl: allocation.invoiceUrl,
    },
    customerGid,
  )) {
    return invalidClaimResponse();
  }

  const now = new Date();
  const updated = await prisma.allocation.updateMany({
    where: {
      id: allocation.id,
      status: { in: ["ISSUED", "OPENED"] },
      deadlineAt: { gt: now },
      raffle: { status: { not: "CANCELLED" } },
    },
    data: { status: "OPENED", openedAt: allocation.openedAt ?? now },
  });
  if (!updated.count) return invalidClaimResponse();
  return claimRedirectResponse(allocation.invoiceUrl);
};
