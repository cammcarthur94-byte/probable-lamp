ALTER TABLE "Raffle" ADD COLUMN "eligibilityRules" TEXT NOT NULL DEFAULT '{"requireAccount":true}';
ALTER TABLE "Entry" ADD COLUMN "emailHash" TEXT;
CREATE UNIQUE INDEX "Entry_raffleId_emailHash_key" ON "Entry"("raffleId", "emailHash");
