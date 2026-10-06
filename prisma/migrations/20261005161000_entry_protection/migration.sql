CREATE TABLE "EntryRateLimitBucket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "customerKey" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "EntryRateLimitBucket_shopDomain_customerKey_windowStart_key"
ON "EntryRateLimitBucket"("shopDomain", "customerKey", "windowStart");

CREATE INDEX "EntryRateLimitBucket_windowStart_idx"
ON "EntryRateLimitBucket"("windowStart");
