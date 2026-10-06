import { createHash, randomBytes } from "node:crypto";

export type ClaimAllocation = {
  customerGid: string;
  deadlineAt: Date;
  status: "PENDING" | "ISSUED" | "OPENED" | "PURCHASED" | "CANCELLED" | "EXPIRED" | "EXPIRING";
  raffleStatus: string;
  invoiceUrl: string | null;
};

export function createClaimToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashClaimToken(token) };
}

export function hashClaimToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function canClaimAllocation(
  allocation: ClaimAllocation,
  customerGid: string | null,
  now = new Date(),
) {
  return Boolean(
    customerGid &&
      customerGid === allocation.customerGid &&
      (allocation.status === "ISSUED" || allocation.status === "OPENED") &&
      now < allocation.deadlineAt &&
      allocation.raffleStatus !== "CANCELLED" &&
      allocation.invoiceUrl,
  );
}

export function invalidClaimResponse() {
  return new Response("This claim link is invalid or expired.", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export function claimRedirectResponse(invoiceUrl: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: invoiceUrl,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
