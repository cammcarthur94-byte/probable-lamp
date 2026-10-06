import { randomBytes } from "node:crypto";
import prisma from "../db.server";
export { pickRandom, pickRaffleWinners } from "./winner-selection";

export function makeHandle(title: string) {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${slug || "raffle"}-${randomBytes(3).toString("hex")}`;
}

export async function createEntry(input: {
  raffleId: string;
  shopDomain: string;
  email: string;
  emailHash: string;
  phoneHash: string | null;
  addressHash: string | null;
  name: string;
  customerId: string;
  variantId: string;
  timeZone?: string | null;
}) {
  const raffle = await prisma.raffle.findFirst({
    where: { id: input.raffleId, shopDomain: input.shopDomain },
    select: { id: true, status: true, startsAt: true, closesAt: true },
  });
  if (!raffle || raffle.status !== "ACTIVE" || !input.customerId) {
    return { kind: "closed" as const };
  }

  const now = new Date();
  if (raffle.startsAt > now) return { kind: "notStarted" as const };
  if (raffle.closesAt <= now) return { kind: "closed" as const };

  try {
    await prisma.$transaction(async (tx) => {
      const acceptingEntries = await tx.raffle.updateMany({
        where: {
          id: raffle.id,
          shopDomain: input.shopDomain,
          status: "ACTIVE",
          startsAt: { lte: now },
          closesAt: { gt: now },
        },
        data: { entryCount: { increment: 1 } },
      });
      if (!acceptingEntries.count) throw new Error("RAFFLE_CLOSED");
      await tx.entry.create({
        data: {
          raffleId: raffle.id,
          email: input.email.toLowerCase(),
          emailHash: input.emailHash,
          phoneHash: input.phoneHash,
          addressHash: input.addressHash,
          name: input.name,
          customerId: input.customerId,
          variantId: input.variantId,
          timeZone: input.timeZone,
        },
      });
    });
    return { kind: "created" as const };
  } catch (error) {
    if (error instanceof Error && error.message === "RAFFLE_CLOSED") {
      return { kind: "closed" as const };
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return { kind: "duplicate" as const };
    }
    throw error;
  }
}
