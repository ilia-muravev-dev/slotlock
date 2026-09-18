-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentEventOutcome" ADD VALUE 'IGNORED';
ALTER TYPE "PaymentEventOutcome" ADD VALUE 'UNKNOWN';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "amountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payment_events" ALTER COLUMN "paymentId" DROP NOT NULL;
