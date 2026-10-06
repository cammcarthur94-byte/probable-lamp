ALTER TABLE "Raffle" ADD COLUMN "retentionCouponEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Raffle" ADD COLUMN "retentionCouponType" TEXT;
ALTER TABLE "Raffle" ADD COLUMN "retentionCouponValue" REAL;
ALTER TABLE "Raffle" ADD COLUMN "retentionCouponExpiryDays" INTEGER;

ALTER TABLE "Entry" ADD COLUMN "outcomeEmailSentAt" DATETIME;
ALTER TABLE "Entry" ADD COLUMN "couponEmailSentAt" DATETIME;
ALTER TABLE "Entry" ADD COLUMN "outcomeEmailError" TEXT;
ALTER TABLE "Entry" ADD COLUMN "retentionCouponCode" TEXT;
