ALTER TABLE "Raffle" ADD COLUMN "claimWindowMinutes" INTEGER NOT NULL DEFAULT 2880;
ALTER TABLE "Raffle" ADD COLUMN "unsoldCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Entry" ADD COLUMN "drawRank" INTEGER;
ALTER TABLE "Allocation" ADD COLUMN "expiryLeaseAt" DATETIME;
ALTER TABLE "Allocation" ADD COLUMN "expiryLeaseToken" TEXT;
ALTER TABLE "Allocation" ADD COLUMN "issuanceLeaseAt" DATETIME;
ALTER TABLE "Allocation" ADD COLUMN "issuanceLeaseToken" TEXT;

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raffleId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AuditLog_raffleId_createdAt_idx" ON "AuditLog"("raffleId", "createdAt");
CREATE INDEX "AuditLog_allocationId_createdAt_idx" ON "AuditLog"("allocationId", "createdAt");

CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resourceGid" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "WebhookEvent_shopDomain_topic_receivedAt_idx" ON "WebhookEvent"("shopDomain", "topic", "receivedAt");

CREATE TABLE "ExpirySweepState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nextRunAt" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
