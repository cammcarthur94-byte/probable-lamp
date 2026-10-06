export type DraftPaymentState = {
  exists: boolean;
  draftStatus: string | null;
  financialStatus: string | null;
};

export function resolveExpiredDraft(state: DraftPaymentState) {
  if (!state.exists) return "EXPIRED" as const;
  if (
    state.draftStatus === "COMPLETED" ||
    state.financialStatus === "PAID"
  ) {
    return "PURCHASED" as const;
  }
  return "DELETE" as const;
}

export function selectWaitlistEntry<T extends { id: string; addressHash: string | null }>(
  entries: T[],
  allocatedAddresses: string[],
  allowMultipleWinnersPerAddress: boolean,
  previouslyAllocatedEntryIds: string[] = [],
) {
  const allocatedEntries = new Set(previouslyAllocatedEntryIds);
  const neverWon = entries.filter((entry) => !allocatedEntries.has(entry.id));
  if (allowMultipleWinnersPerAddress) return neverWon[0] ?? null;
  const used = new Set(allocatedAddresses.filter(Boolean));
  return neverWon.find((entry) => !entry.addressHash || !used.has(entry.addressHash)) ?? null;
}

export async function claimExpiryLease(
  claim: (leaseToken: string) => Promise<boolean>,
  leaseToken: string,
) {
  return claim(leaseToken);
}
