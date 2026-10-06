ALTER TABLE "Shop" ADD COLUMN "emailReplyTo" TEXT;
ALTER TABLE "Shop" ADD COLUMN "emailSubject" TEXT;
ALTER TABLE "Shop" ADD COLUMN "emailMessage" TEXT;

ALTER TABLE "Raffle" ADD COLUMN "allowMultipleWinnersPerAddress" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Entry" ADD COLUMN "timeZone" TEXT;

DROP INDEX "Entry_raffleId_addressHash_key";

CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raffleId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "draftOrderId" TEXT,
    "invoiceUrl" TEXT,
    "claimTokenHash" TEXT NOT NULL,
    "deadlineAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "openedAt" DATETIME,
    "purchasedAt" DATETIME,
    "cancelledAt" DATETIME,
    "orderId" TEXT,
    "emailSentAt" DATETIME,
    "notificationError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Allocation_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Allocation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Allocation_entryId_key" ON "Allocation"("entryId");
CREATE UNIQUE INDEX "Allocation_draftOrderId_key" ON "Allocation"("draftOrderId");
CREATE UNIQUE INDEX "Allocation_claimTokenHash_key" ON "Allocation"("claimTokenHash");
CREATE UNIQUE INDEX "Allocation_orderId_key" ON "Allocation"("orderId");
CREATE INDEX "Allocation_raffleId_status_idx" ON "Allocation"("raffleId", "status");
CREATE INDEX "Allocation_deadlineAt_status_idx" ON "Allocation"("deadlineAt", "status");
