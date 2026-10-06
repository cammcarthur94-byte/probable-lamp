PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Raffle" (
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
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Raffle_shopDomain_fkey" FOREIGN KEY ("shopDomain") REFERENCES "Shop" ("domain") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Raffle" (
    "closesAt",
    "createdAt",
    "description",
    "entryCount",
    "handle",
    "id",
    "productId",
    "productImageUrl",
    "productTitle",
    "productVariantId",
    "shopDomain",
    "status",
    "title",
    "updatedAt",
    "winnerCount"
)
SELECT
    COALESCE("closesAt", CURRENT_TIMESTAMP),
    "createdAt",
    "description",
    "entryCount",
    "handle",
    "id",
    "productId",
    "productImageUrl",
    "productTitle",
    "productVariantId",
    "shopDomain",
    "status",
    "title",
    "updatedAt",
    "winnerCount"
FROM "Raffle";

DROP TABLE "Raffle";
ALTER TABLE "new_Raffle" RENAME TO "Raffle";
CREATE INDEX "Raffle_shopDomain_status_idx" ON "Raffle"("shopDomain", "status");
CREATE UNIQUE INDEX "Raffle_shopDomain_handle_key" ON "Raffle"("shopDomain", "handle");
DROP INDEX "Entry_raffleId_email_key";
CREATE UNIQUE INDEX "Entry_raffleId_customerId_key" ON "Entry"("raffleId", "customerId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
