ALTER TABLE "Entry" ADD COLUMN "phoneHash" TEXT;
ALTER TABLE "Entry" ADD COLUMN "addressHash" TEXT;

CREATE UNIQUE INDEX "Entry_raffleId_phoneHash_key"
ON "Entry"("raffleId", "phoneHash");

CREATE UNIQUE INDEX "Entry_raffleId_addressHash_key"
ON "Entry"("raffleId", "addressHash");
