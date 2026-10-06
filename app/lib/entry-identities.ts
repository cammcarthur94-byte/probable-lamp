import { createHmac } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export type EntryAddress = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

export function normalizePhone(phone: string | null, countryCode: string | null) {
  const input = phone?.trim();
  if (!input) return null;
  const region = countryCode?.trim().toUpperCase();
  const parsed = parsePhoneNumberFromString(input, region as Parameters<typeof parsePhoneNumberFromString>[1]);
  if (parsed?.isPossible()) return parsed.number;

  const digits = input.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return region ? `${region}:${digits}` : digits;
}

function normalizeAddressPart(value: string | null, mode: "text" | "postal" = "text") {
  if (!value) return "";
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return mode === "postal"
    ? normalized.replace(/[^a-z0-9]/g, "")
    : normalized.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function normalizeAddress(address: EntryAddress | null) {
  if (!address) return null;
  const parts = [
    normalizeAddressPart(address.address1),
    normalizeAddressPart(address.address2),
    normalizeAddressPart(address.city),
    normalizeAddressPart(address.provinceCode),
    normalizeAddressPart(address.postalCode, "postal"),
    normalizeAddressPart(address.countryCode),
  ];
  if (!parts[0] || !parts[2] || !parts[4] || !parts[5]) return null;
  return parts.join("|");
}

export function hashEntryIdentity(value: string | null, secret: string) {
  if (!value) return null;
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function hashEntryPhone(
  customerPhone: string | null,
  addressPhone: string | null,
  countryCode: string | null,
  secret: string,
) {
  const normalized =
    normalizePhone(customerPhone, countryCode) ??
    normalizePhone(addressPhone, countryCode);
  return hashEntryIdentity(normalized, secret);
}

export function hashEntryAddress(address: EntryAddress | null, secret: string) {
  return hashEntryIdentity(normalizeAddress(address), secret);
}
