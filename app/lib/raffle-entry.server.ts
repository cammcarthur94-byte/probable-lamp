import prisma from "../db.server";
import {
  evaluateEligibility,
  hashNormalizedEmail,
  normalizeEmail,
  parseEligibilityRules,
  type EligibilityRequestContext,
  type EligibilityResult,
} from "./eligibility";
import { hashEntryAddress, hashEntryPhone } from "./entry-identities";
import { getShopifyEligibilityCustomer } from "./shopify-customer.server";
import { getRaffleProductVariants } from "./shopify-product.server";
import { createEntry } from "./raffles.server";

export type RaffleEntryResult =
  | { kind: "created" }
  | {
      kind:
        | "invalid"
        | "unauthenticated"
        | "notFound"
        | "duplicate"
        | "notStarted"
        | "closed"
        | "customerNotFound"
        | "emailMismatch"
        | "invalidVariant"
        | "ineligible";
      eligibility?: EligibilityResult;
    };

export async function submitRaffleEntry({
  shopDomain,
  handle,
  customerId,
  name,
  email,
  variantId,
  timeZone,
}: {
  shopDomain: string;
  handle: string;
  customerId: string | null;
  name: string;
  email: string;
  variantId: string;
  timeZone?: string | null;
}): Promise<RaffleEntryResult> {
  if (!customerId) return { kind: "unauthenticated" };
  if (name.length > 120 || !normalizeEmail(email)) {
    return { kind: "invalid" };
  }

  const raffle = await prisma.raffle.findFirst({
    where: { shopDomain, handle },
    select: { id: true, rules: true, createdAt: true, productId: true },
  });
  if (!raffle) return { kind: "notFound" };

  const product = await getRaffleProductVariants(shopDomain, raffle.productId);
  if (!product.variants.some((variant) => variant.id === variantId)) {
    return { kind: "invalidVariant" };
  }

  const customer = await getShopifyEligibilityCustomer(shopDomain, customerId);
  if (!customer) return { kind: "customerNotFound" };
  const normalizedEmail = normalizeEmail(email);
  const customerEmail = customer.email ? normalizeEmail(customer.email) : null;
  if (!normalizedEmail || !customerEmail || normalizedEmail !== customerEmail) {
    return { kind: "emailMismatch" };
  }

  const rules = parseEligibilityRules(raffle.rules);
  const requestContext: EligibilityRequestContext = {
    loggedInCustomerId: customerId,
    drawAnnouncedAt: raffle.createdAt,
    now: new Date(),
  };
  const eligibility = evaluateEligibility(rules, customer, requestContext);
  if (!eligibility.eligible) return { kind: "ineligible", eligibility };

  const emailHash = hashNormalizedEmail(email);
  if (!emailHash) return { kind: "invalid" };
  const identitySecret = process.env.SHOPIFY_API_SECRET;
  if (!identitySecret) {
    throw new Error("SHOPIFY_API_SECRET is required to protect duplicate-entry identifiers.");
  }
  const phoneHash = hashEntryPhone(
    customer.phone,
    customer.defaultAddress?.phone ?? null,
    customer.defaultAddress?.countryCode ?? null,
    identitySecret,
  );
  const addressHash = hashEntryAddress(
    customer.defaultAddress
      ? {
          address1: customer.defaultAddress.address1 ?? null,
          address2: customer.defaultAddress.address2 ?? null,
          city: customer.defaultAddress.city ?? null,
          provinceCode: customer.defaultAddress.provinceCode ?? null,
          postalCode: customer.defaultAddress.postalCode ?? null,
          countryCode: customer.defaultAddress.countryCode,
        }
      : null,
    identitySecret,
  );
  const legacyEntries = await prisma.entry.findMany({
    where: { raffleId: raffle.id, emailHash: null },
    select: { email: true },
  });
  if (legacyEntries.some((entry) => normalizeEmail(entry.email) === normalizedEmail)) {
    return { kind: "duplicate" };
  }

  const outcome = await createEntry({
    raffleId: raffle.id,
    shopDomain,
    email: email.trim().toLowerCase(),
    emailHash,
    phoneHash,
    addressHash,
    name: name || customer.name,
    customerId,
    variantId,
    timeZone: validatedTimeZone(timeZone),
  });
  return outcome.kind === "created" ? { kind: "created" } : outcome;
}

function validatedTimeZone(timeZone: string | null | undefined) {
  if (!timeZone || timeZone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return timeZone;
  } catch {
    return null;
  }
}
