-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
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
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "Shop" (
    "domain" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "storefrontUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productImageUrl" TEXT,
    "productVariantId" TEXT NOT NULL,
    "winnerCount" INTEGER NOT NULL DEFAULT 1,
    "prizeDiscountPercent" INTEGER NOT NULL DEFAULT 100,
    "maxEntries" INTEGER,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "closesAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Raffle_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop" ("domain") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raffleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Entry_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Winner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raffleId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "draftOrderId" TEXT NOT NULL,
    "invoiceUrl" TEXT NOT NULL,
    "checkoutToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "emailSentAt" DATETIME,
    "notificationError" TEXT,
    "draftOrderDeletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Winner_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Winner_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "Entry_raffleId_email_key" ON "Entry"("raffleId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_entryId_key" ON "Winner"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_checkoutToken_key" ON "Winner"("checkoutToken");

-- CreateIndex
CREATE INDEX "Winner_raffleId_expiresAt_idx" ON "Winner"("raffleId", "expiresAt");

-- CreateIndex
CREATE INDEX "Winner_expiresAt_draftOrderDeletedAt_idx" ON "Winner"("expiresAt", "draftOrderDeletedAt");
