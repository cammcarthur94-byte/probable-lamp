import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { useEffect } from "react";
import prisma from "../db.server";
import { submitRaffleEntry } from "../lib/raffle-entry.server";
import { consumeEntryAttempt, createEntryProof } from "../lib/entry-rate-limit.server";
import { verifyEntryProof } from "../lib/entry-protection";
import { ShopifyCustomerDataAccessError } from "../lib/shopify-customer.server";
import { getRaffleProductVariants } from "../lib/shopify-product.server";
import { authenticate } from "../shopify.server";
import { formatMoney } from "../lib/pricing";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const shopDomain = new URL(request.url).searchParams.get("shop");
  if (!shopDomain || !params.handle) {
    throw new Response("Invalid raffle link.", { status: 400 });
  }
  const raffle = await prisma.raffle.findFirst({
    where: { shopDomain, handle: params.handle },
    select: {
      title: true,
      description: true,
      productId: true,
      productTitle: true,
      productImageUrl: true,
      winnerPrice: true,
      priceCurrency: true,
      status: true,
      startsAt: true,
      closesAt: true,
    },
  });
  if (!raffle) throw new Response("Raffle not found.", { status: 404 });
  const product = await getRaffleProductVariants(shopDomain, raffle.productId);
  const pathPrefix = new URL(request.url).searchParams.get("path_prefix") || "/apps/fairdrop";
  const returnPath = `${pathPrefix.replace(/\/+$/, "")}/raffles/${encodeURIComponent(params.handle)}`;
  return {
    raffle: { ...raffle, ...product },
    customerSignedIn: Boolean(new URL(request.url).searchParams.get("logged_in_customer_id")),
    loginUrl: `/account/login?return_url=${encodeURIComponent(returnPath)}`,
    entryProof: createEntryProof(shopDomain, params.handle),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!shopDomain || !params.handle) {
    return { error: "This raffle could not be found.", success: false };
  }
  if (String(formData.get("website") ?? "").trim()) {
    return { error: "Unable to submit this entry. Reload the page and try again.", success: false };
  }
  const proofResult = verifyEntryProof(
    String(formData.get("entryProof") ?? ""),
    shopDomain,
    params.handle,
  );
  if (!proofResult.valid) {
    return {
      error:
        proofResult.reason === "tooFast"
          ? "Please wait a moment before submitting your entry."
          : "This entry form has expired. Reload the page and try again.",
      success: false,
    };
  }
  if (!customerId) {
    return { error: "Log in to your store customer account before entering.", success: false };
  }
  if (await consumeEntryAttempt(shopDomain, customerId)) {
    return {
      error: "Too many entry attempts. Please wait 10 minutes before trying again.",
      success: false,
    };
  }
  let outcome: Awaited<ReturnType<typeof submitRaffleEntry>>;
  try {
    outcome = await submitRaffleEntry({
      shopDomain,
      handle: params.handle,
      customerId,
      name,
      email,
      variantId: String(formData.get("variantId") ?? ""),
      timeZone: String(formData.get("timeZone") ?? "").trim() || null,
    });
  } catch (error) {
    if (error instanceof ShopifyCustomerDataAccessError) {
      return {
        error:
          "Raffle entry is temporarily unavailable because the store has not enabled the required customer-data access. Please contact the store and try again later.",
        success: false,
      };
    }
    console.error("Fairdrop could not submit a storefront raffle entry.", error);
    return {
      error: "Your entry could not be submitted right now. Please refresh and try again.",
      success: false,
    };
  }
  switch (outcome.kind) {
    case "created":
      return { success: true, message: "You're in! Good luck." };
    case "unauthenticated":
      return { error: "Log in to your store customer account before entering.", success: false };
    case "invalid":
      return { error: "Enter a valid name and email address.", success: false };
    case "notFound":
      return { error: "This raffle could not be found.", success: false };
    case "duplicate":
      return { error: "Your customer account has already entered this raffle.", success: false };
    case "notStarted":
      return { error: "Entries have not opened yet.", success: false };
    case "closed":
      return { error: "This raffle is closed or is no longer accepting entries.", success: false };
    case "customerNotFound":
      return { error: "Your customer account could not be verified. Please contact the store.", success: false };
    case "emailMismatch":
      return { error: "Enter the email address saved to your customer account.", success: false };
    case "invalidVariant":
      return { error: "Choose an available product option before entering.", success: false };
    case "ineligible":
      return { error: outcome.eligibility?.userMessage ?? "You are not eligible to enter this raffle.", success: false };
  }
};

export default function StorefrontRaffle() {
  const { raffle, customerSignedIn, loginUrl, entryProof } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const now = Date.now();
  const notStarted = new Date(raffle.startsAt).getTime() > now;
  const closed = raffle.status !== "ACTIVE" || new Date(raffle.closesAt).getTime() <= now;
  useEffect(() => {
    const field = document.getElementById("entrant-time-zone");
    if (field instanceof HTMLInputElement) {
      field.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    }
  }, []);
  return (
    <main className="storefront-shell">
      <article className="storefront-card">
        {(raffle.productImageUrl || raffle.productImageFallback) && <img className="storefront-image" src={raffle.productImageUrl || raffle.productImageFallback || undefined} alt={raffle.productImageAlt || raffle.productTitle} />}
        <p className="storefront-eyebrow">FAIRDROP PRODUCT RAFFLE</p>
        <h1>{raffle.title}</h1>
        <h2>{raffle.productTitle}</h2>
        {raffle.description && <p className="storefront-description">{raffle.description}</p>}
        <p className="storefront-meta">Entries open {new Date(raffle.startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" })} and close {new Date(raffle.closesAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" })} (your local time).</p>
        {raffle.winnerPrice != null && (
          <p className="storefront-meta"><strong>Winner price: {formatMoney(raffle.winnerPrice, raffle.priceCurrency)}</strong></p>
        )}
        <p className="storefront-meta">One entry per customer.{raffle.winnerPrice != null ? ` Winners purchase at ${formatMoney(raffle.winnerPrice, raffle.priceCurrency)}.` : ""}</p>
        {result?.success ? (
          <div className="storefront-success" role="status">{result.message}</div>
        ) : (
          <>
            {notStarted && raffle.status === "ACTIVE" && <div className="storefront-meta">Entries have not opened yet. Check back at the start time above.</div>}
            {closed && <div className="storefront-error">This raffle is no longer accepting entries.</div>}
            {result && "error" in result && <div className="storefront-error" role="alert">{result.error}</div>}
            {!notStarted && !closed && !customerSignedIn && (
              <div className="storefront-error">
                <p>Log in to your store customer account to enter. Each customer can enter once.</p>
                <a href={loginUrl}>Log in to enter</a>
              </div>
            )}
            {!notStarted && !closed && customerSignedIn && !raffle.variants.length && (
              <div className="storefront-error" role="status">
                This product currently has no available options for the raffle. Please contact the store.
              </div>
            )}
            {!notStarted && !closed && customerSignedIn && raffle.variants.length > 0 && (
              <form className="storefront-form" method="post">
                <label htmlFor="entrant-name">Your name</label>
                <input id="entrant-name" name="name" autoComplete="name" maxLength={120} required />
                {raffle.variants.length > 1 && (
                  <>
                    <label htmlFor="entrant-variant">Choose your product options</label>
                    <select id="entrant-variant" name="variantId" required defaultValue="">
                      <option value="" disabled>Select an option</option>
                      {raffle.variants.map((variant) => {
                        const options = variant.selectedOptions
                          .filter((option) => option.value !== "Default Title")
                          .map((option) => `${option.name}: ${option.value}`)
                          .join(" · ");
                        return (
                          <option key={variant.id} value={variant.id}>
                            {options || variant.title} — {new Intl.NumberFormat(undefined, { style: "currency", currency: raffle.currencyCode }).format(Number(variant.price))}
                          </option>
                        );
                      })}
                    </select>
                  </>
                )}
                {raffle.variants.length === 1 && <input type="hidden" name="variantId" value={raffle.variants[0].id} />}
                <label htmlFor="entrant-email">Email address</label>
                <input id="entrant-email" name="email" type="email" autoComplete="email" maxLength={254} required />
                <input type="hidden" name="timeZone" id="entrant-time-zone" />
                <input type="hidden" name="entryProof" value={entryProof} />
                <div
                  className="fairdrop-entry-block__honeypot"
                  aria-hidden="true"
                  style={{ position: "absolute", left: "-10000px", top: "auto" }}
                >
                  <label htmlFor="entrant-website">Leave this field empty</label>
                  <input id="entrant-website" name="website" tabIndex={-1} autoComplete="off" />
                </div>
                <button type="submit">Enter raffle</button>
                <small>One entry per customer account. Winners receive an email if selected.</small>
              </form>
            )}
          </>
        )}
      </article>
    </main>
  );
}
