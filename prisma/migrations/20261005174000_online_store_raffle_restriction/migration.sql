ALTER TABLE "Raffle" ADD COLUMN "restrictOnlineStore" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Raffle" ADD COLUMN "onlineStorePublicationId" TEXT;
ALTER TABLE "Raffle" ADD COLUMN "onlineStorePublishDate" DATETIME;
ALTER TABLE "Raffle" ADD COLUMN "onlineStoreWasPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Raffle" ADD COLUMN "onlineStoreRestrictedAt" DATETIME;
ALTER TABLE "Raffle" ADD COLUMN "onlineStoreRestoredAt" DATETIME;
