-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "blurScore" DOUBLE PRECISION,
ADD COLUMN     "blurred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "perceptualHash" TEXT;
