-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('PENDING', 'ISSUED', 'OPENED', 'PURCHASED', 'CANCELLED', 'EXPIRED', 'EXPIRING');

-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('ACTIVE', 'DRAWN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "storefrontUrl" TEXT,
    "emailReplyTo" TEXT,
    "emailSubject" TEXT,
    "emailMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productImageUrl" TEXT,
    "productVariantId" TEXT NOT NULL,
    "winnerCount" INTEGER NOT NULL DEFAULT 1,
    "rules" TEXT NOT NULL DEFAULT '{"requireAccount":true}',
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "RaffleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowMultipleWinnersPerAddress" BOOLEAN NOT NULL DEFAULT false,
    "claimWindowMinutes" INTEGER NOT NULL DEFAULT 2880,
    "unsoldCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3),
    "purgeNextRunAt" TIMESTAMP(3),
    "restrictOnlineStore" BOOLEAN NOT NULL DEFAULT false,
    "onlineStorePublicationId" TEXT,
    "onlineStorePublishDate" TIMESTAMP(3),
    "onlineStoreWasPublished" BOOLEAN NOT NULL DEFAULT false,
    "onlineStoreRestrictedAt" TIMESTAMP(3),
    "onlineStoreRestoredAt" TIMESTAMP(3),
    "retentionCouponEnabled" BOOLEAN NOT NULL DEFAULT false,
    "retentionCouponType" TEXT,
    "retentionCouponValue" DOUBLE PRECISION,
    "retentionCouponExpiryDays" INTEGER,

    CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailHash" TEXT,
    "phoneHash" TEXT,
    "addressHash" TEXT,
    "timeZone" TEXT,
    "drawRank" INTEGER,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "variantId" TEXT,
    "outcomeEmailSentAt" TIMESTAMP(3),
    "couponEmailSentAt" TIMESTAMP(3),
    "outcomeEmailError" TEXT,
    "retentionCouponCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "draftOrderId" TEXT,
    "invoiceUrl" TEXT,
    "claimTokenHash" TEXT NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PENDING',
    "openedAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "orderId" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "notificationError" TEXT,
    "expiryLeaseAt" TIMESTAMP(3),
    "expiryLeaseToken" TEXT,
    "issuanceLeaseAt" TIMESTAMP(3),
    "issuanceLeaseToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryRateLimitBucket" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "customerKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EntryRateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resourceGid" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpirySweepState" (
    "id" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpirySweepState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Winner" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "draftOrderId" TEXT NOT NULL,
    "invoiceUrl" TEXT NOT NULL,
    "checkoutToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "emailSentAt" TIMESTAMP(3),
    "notificationError" TEXT,
    "draftOrderDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Winner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Raffle_shopDomain_status_idx" ON "Raffle"("shopDomain", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Raffle_shopDomain_handle_key" ON "Raffle"("shopDomain", "handle");

-- CreateIndex
CREATE INDEX "Entry_raffleId_createdAt_idx" ON "Entry"("raffleId", "createdAt");

-- CreateIndex
CREATE INDEX "Entry_raffleId_drawRank_idx" ON "Entry"("raffleId", "drawRank");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_raffleId_customerId_key" ON "Entry"("raffleId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_raffleId_emailHash_key" ON "Entry"("raffleId", "emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_raffleId_phoneHash_key" ON "Entry"("raffleId", "phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_entryId_key" ON "Allocation"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_draftOrderId_key" ON "Allocation"("draftOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_claimTokenHash_key" ON "Allocation"("claimTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_orderId_key" ON "Allocation"("orderId");

-- CreateIndex
CREATE INDEX "Allocation_raffleId_status_idx" ON "Allocation"("raffleId", "status");

-- CreateIndex
CREATE INDEX "Allocation_deadlineAt_status_idx" ON "Allocation"("deadlineAt", "status");

-- CreateIndex
CREATE INDEX "EntryRateLimitBucket_windowStart_idx" ON "EntryRateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "EntryRateLimitBucket_shopDomain_customerKey_windowStart_key" ON "EntryRateLimitBucket"("shopDomain", "customerKey", "windowStart");

-- CreateIndex
CREATE INDEX "AuditLog_raffleId_createdAt_idx" ON "AuditLog"("raffleId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_allocationId_createdAt_idx" ON "AuditLog"("allocationId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopDomain_topic_receivedAt_idx" ON "WebhookEvent"("shopDomain", "topic", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_entryId_key" ON "Winner"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_checkoutToken_key" ON "Winner"("checkoutToken");

-- CreateIndex
CREATE INDEX "Winner_raffleId_expiresAt_idx" ON "Winner"("raffleId", "expiresAt");

-- CreateIndex
CREATE INDEX "Winner_expiresAt_draftOrderDeletedAt_idx" ON "Winner"("expiresAt", "draftOrderDeletedAt");

-- AddForeignKey
ALTER TABLE "Raffle" ADD CONSTRAINT "Raffle_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

