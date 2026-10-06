import { createHash } from "node:crypto";

export type EligibilityRules = {
  requireAccount?: boolean;
  requireVerifiedEmail?: boolean;
  allowedCountries?: string[];
  minAccountAgeDays?: number;
  requirePhone?: boolean;
};

export type EligibilityCustomer = {
  verifiedEmail: boolean | null;
  email: string | null;
  createdAt: Date | string | null;
  phone: string | null;
  defaultAddress: {
    countryCode: string | null;
    phone: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    provinceCode?: string | null;
    postalCode?: string | null;
  } | null;
};

export type EligibilityRequestContext = {
  loggedInCustomerId: string | null;
  drawAnnouncedAt: Date | string;
  now?: Date;
  geoIpCountry?: string | null;
};

export type EligibilityReasonCode =
  | "ELIGIBLE"
  | "ACCOUNT_REQUIRED"
  | "CUSTOMER_NOT_FOUND"
  | "EMAIL_MISMATCH"
  | "EMAIL_UNVERIFIED"
  | "COUNTRY_NOT_ALLOWED"
  | "ACCOUNT_TOO_NEW"
  | "PHONE_REQUIRED"
  | "DISPOSABLE_EMAIL"
  | "INVALID_EMAIL";

export type EligibilityResult = {
  eligible: boolean;
  reasonCode: EligibilityReasonCode;
  userMessage: string;
};

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "dispostable.com",
  "fakeinbox.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "maildrop.cc",
  "mailinator.com",
  "mintemail.com",
  "mohmal.com",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.net",
  "throwawaymail.com",
  "yopmail.com",
]);

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  const separator = trimmed.lastIndexOf("@");
  if (
    separator <= 0 ||
    separator === trimmed.length - 1 ||
    trimmed.indexOf("@") !== separator
  ) {
    return null;
  }

  let localPart = trimmed.slice(0, separator).split("+", 1)[0];
  let domain = trimmed.slice(separator + 1);
  if (!localPart || !domain || /\s/.test(trimmed)) return null;

  if (domain === "gmail.com" || domain === "googlemail.com") {
    localPart = localPart.replaceAll(".", "");
    domain = "gmail.com";
  }

  return `${localPart}@${domain}`;
}

export function hashNormalizedEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function parseEligibilityRules(serialized: string): EligibilityRules {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Raffle eligibility rules contain invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Raffle eligibility rules must be an object.");
  }

  const rules = parsed as Record<string, unknown>;
  if (
    (rules.requireAccount !== undefined && typeof rules.requireAccount !== "boolean") ||
    (rules.requireVerifiedEmail !== undefined && typeof rules.requireVerifiedEmail !== "boolean") ||
    (rules.requirePhone !== undefined && typeof rules.requirePhone !== "boolean") ||
    (rules.minAccountAgeDays !== undefined &&
      (typeof rules.minAccountAgeDays !== "number" ||
        !Number.isInteger(rules.minAccountAgeDays) ||
        rules.minAccountAgeDays < 0)) ||
    (rules.allowedCountries !== undefined &&
      (!Array.isArray(rules.allowedCountries) ||
        rules.allowedCountries.some((country) => typeof country !== "string")))
  ) {
    throw new Error("Raffle eligibility rules contain invalid values.");
  }

  return rules as EligibilityRules;
}

export function evaluateEligibility(
  rules: EligibilityRules,
  customer: EligibilityCustomer,
  requestContext: EligibilityRequestContext,
): EligibilityResult {
  const fail = (
    reasonCode: Exclude<EligibilityReasonCode, "ELIGIBLE" | "CUSTOMER_NOT_FOUND" | "EMAIL_MISMATCH">,
    userMessage: string,
  ): EligibilityResult => ({ eligible: false, reasonCode, userMessage });

  if (rules.requireAccount && !requestContext.loggedInCustomerId) {
    return fail("ACCOUNT_REQUIRED", "Log in to your customer account to enter this raffle.");
  }

  if (rules.requireVerifiedEmail && customer.verifiedEmail !== true) {
    return fail("EMAIL_UNVERIFIED", "Verify your customer account email before entering.");
  }

  const allowedCountries = (rules.allowedCountries ?? [])
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
  if (allowedCountries.length) {
    const customerCountry = customer.defaultAddress?.countryCode?.trim().toUpperCase();
    if (!customerCountry || !allowedCountries.includes(customerCountry)) {
      return fail("COUNTRY_NOT_ALLOWED", "This raffle is not available in your default-address country.");
    }
  }

  const minAccountAgeDays = rules.minAccountAgeDays ?? 0;
  if (minAccountAgeDays > 0) {
    const createdAt =
      customer.createdAt instanceof Date
        ? customer.createdAt
        : customer.createdAt
          ? new Date(customer.createdAt)
          : null;
    const announcedAt =
      requestContext.drawAnnouncedAt instanceof Date
        ? requestContext.drawAnnouncedAt
        : new Date(requestContext.drawAnnouncedAt);
    if (Number.isNaN(announcedAt.getTime())) {
      return fail("ACCOUNT_TOO_NEW", "This raffle's account-age requirement could not be verified.");
    }
    const cutoff = new Date(
      announcedAt.getTime() - minAccountAgeDays * 24 * 60 * 60 * 1000,
    );
    if (!createdAt || Number.isNaN(createdAt.getTime()) || createdAt >= cutoff) {
      return fail(
        "ACCOUNT_TOO_NEW",
        `Your customer account must be at least ${minAccountAgeDays} days old before this raffle was announced.`,
      );
    }
  }

  if (
    rules.requirePhone &&
    !(customer.phone?.trim() || customer.defaultAddress?.phone?.trim())
  ) {
    return fail("PHONE_REQUIRED", "Add a phone number to your customer account before entering.");
  }

  const normalizedEmail = normalizeEmail(customer.email ?? "");
  if (!normalizedEmail) {
    return fail("INVALID_EMAIL", "A valid email address is required to enter this raffle.");
  }
  const emailDomain = normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1);
  if (DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
    return fail("DISPOSABLE_EMAIL", "Use a non-disposable email address to enter this raffle.");
  }

  return {
    eligible: true,
    reasonCode: "ELIGIBLE",
    userMessage: "You meet the eligibility requirements for this raffle.",
  };
}
