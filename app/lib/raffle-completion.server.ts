import type { Prisma } from "@prisma/client";
import { PURGE_RETENTION_DAYS } from "./purge-schedule";

export { PURGE_RETENTION_DAYS as RAFFLE_PURGE_RETENTION_DAYS };

export async function completeRaffleIfSettled(tx: Prisma.TransactionClient, raffleId: string) {
  const [raffle, purchasedCount] = await Promise.all([
    tx.raffle.findUnique({
      where: { id: raffleId },
      select: { winnerCount: true, unsoldCount: true, status: true },
    }),
    tx.allocation.count({ where: { raffleId, status: "PURCHASED" } }),
  ]);
  if (raffle && raffle.status !== "CANCELLED" && purchasedCount + raffle.unsoldCount >= raffle.winnerCount) {
    const completedAt = new Date();
    const purgeAt = new Date(
      completedAt.getTime() + PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const updated = await tx.raffle.updateMany({
      where: { id: raffleId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      data: { status: "COMPLETED", completedAt, purgeAt },
    });
    return updated.count ? purgeAt : null;
  }
  return null;
}
