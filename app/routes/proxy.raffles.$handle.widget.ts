import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { parseEligibilityRules } from "../lib/eligibility";
import { submitRaffleEntry } from "../lib/raffle-entry.server";
import { consumeEntryAttempt } from "../lib/entry-rate-limit.server";
import { verifyEntryProof } from "../lib/entry-protection";
import { ShopifyCustomerDataAccessError } from "../lib/shopify-customer.server";
import { getRaffleProductVariants } from "../lib/shopify-product.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop");
    if (!shopDomain || !params.handle) {
      return Response.json({ error: "Invalid raffle link." }, { status: 400 });
    }

    const raffle = await prisma.raffle.findFirst({
      where: { shopDomain, handle: params.handle },
      select: {
        title: true,
        description: true,
        productId: true,
        productTitle: true,
        productImageUrl: true,
        rules: true,
        status: true,
        startsAt: true,
        closesAt: true,
      },
    });
    if (!raffle) return Response.json({ error: "Raffle not found." }, { status: 404 });

    const now = new Date();
    const entryState =
      raffle.status !== "ACTIVE" || raffle.closesAt <= now
        ? "closed"
        : raffle.startsAt > now
          ? "scheduled"
          : "open";
    const product = await getRaffleProductVariants(shopDomain, raffle.productId);

    return Response.json(
      {
        raffle: { ...raffle, ...product, rules: parseEligibilityRules(raffle.rules) },
        entryState,
        customerSignedIn: Boolean(url.searchParams.get("logged_in_customer_id")),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Fairdrop could not load a storefront raffle.", error);
    return Response.json(
      { error: "Raffle details are temporarily unavailable. Please refresh and try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");
  if (!shopDomain || !params.handle) {
    return Response.json({ error: "This raffle could not be found." });
  }

  const formData = await request.formData();
  if (String(formData.get("website") ?? "").trim()) {
    return Response.json({ error: "Unable to submit this entry. Reload the page and try again." });
  }

  const proof = String(formData.get("entryProof") ?? "");
  const proofResult = verifyEntryProof(proof, shopDomain, params.handle);
  if (!proofResult.valid) {
    return Response.json({
      error:
        proofResult.reason === "tooFast"
          ? "Please wait a moment before submitting your entry."
          : "This entry form has expired. Reload the page and try again.",
    });
  }

  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) {
    return Response.json({ error: "Log in to your store customer account before entering." });
  }
  if (await consumeEntryAttempt(shopDomain, customerId)) {
    return Response.json({
      error: "Too many entry attempts. Please wait 10 minutes before trying again.",
    });
  }

  let result: Awaited<ReturnType<typeof submitRaffleEntry>>;
  try {
    result = await submitRaffleEntry({
      shopDomain,
      handle: params.handle,
      customerId,
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      variantId: String(formData.get("variantId") ?? ""),
      timeZone: String(formData.get("timeZone") ?? "").trim() || null,
    });
  } catch (error) {
    if (error instanceof ShopifyCustomerDataAccessError) {
      return Response.json(
        {
          error:
            "Raffle entry is temporarily unavailable because the store has not enabled the required customer-data access. Please contact the store and try again later.",
        },
      );
    }
    console.error("Fairdrop could not submit a storefront raffle entry.", error);
    return Response.json(
      { error: "Your entry could not be submitted right now. Please refresh and try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  switch (result.kind) {
    case "created":
      return Response.json({ message: "You're in! Good luck." });
    case "unauthenticated":
      return Response.json({ error: "Log in to your store customer account before entering." });
    case "invalid":
      return Response.json({ error: "Enter a valid name and email address." });
    case "notFound":
      return Response.json({ error: "This raffle could not be found." });
    case "duplicate":
      return Response.json({ error: "Your customer account has already entered this raffle." });
    case "notStarted":
      return Response.json({ error: "Entries have not opened yet." });
    case "closed":
      return Response.json({ error: "This raffle is closed or is no longer accepting entries." });
    case "customerNotFound":
      return Response.json({ error: "Your customer account could not be verified. Please contact the store." });
    case "emailMismatch":
      return Response.json({ error: "Enter the email address saved to your customer account." });
    case "invalidVariant":
      return Response.json({ error: "Choose an available product option before entering." });
    case "ineligible":
      return Response.json(
        { error: result.eligibility?.userMessage ?? "You are not eligible to enter this raffle." },
      );
  }
};
