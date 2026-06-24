-- DropIndex
DROP INDEX "Photo_filename_idx";

-- DropIndex
DROP INDEX "Photo_mimeType_idx";

-- DropIndex
DROP INDEX "Photo_tags_idx";

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "largeS3Key" TEXT;
