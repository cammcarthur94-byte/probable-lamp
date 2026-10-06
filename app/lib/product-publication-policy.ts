export type RafflePublicationState = {
  status: string;
  startsAt: Date;
  closesAt: Date;
  wasPublished: boolean;
  restrictedAt: Date | null;
};

export function getRafflePublicationAction(
  raffle: RafflePublicationState,
  now: Date,
) {
  if (raffle.status === "ACTIVE") {
    if (raffle.startsAt > now) return "wait" as const;
    if (raffle.closesAt <= now) return "wait" as const;
    return "enforce" as const;
  }
  if (raffle.status === "DRAWN") return "wait" as const;
  if (raffle.restrictedAt && raffle.wasPublished) return "restore" as const;
  return "finish" as const;
}
