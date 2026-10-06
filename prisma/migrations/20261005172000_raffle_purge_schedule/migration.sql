ALTER TABLE "Raffle" ADD COLUMN "completedAt" DATETIME;
ALTER TABLE "Raffle" ADD COLUMN "purgeAt" DATETIME;
ALTER TABLE "Raffle" ADD COLUMN "purgeNextRunAt" DATETIME;
UPDATE "Raffle"
SET "completedAt" = "updatedAt",
    "purgeAt" = datetime("updatedAt", '+30 days')
WHERE "status" = 'COMPLETED';
