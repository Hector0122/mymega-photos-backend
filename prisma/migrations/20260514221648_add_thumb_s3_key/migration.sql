-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "thumbS3Key" TEXT;

-- CreateIndex
CREATE INDEX "Album_userId_idx" ON "Album"("userId");

-- CreateIndex
CREATE INDEX "Photo_userId_idx" ON "Photo"("userId");

-- CreateIndex
CREATE INDEX "Photo_userId_favorite_idx" ON "Photo"("userId", "favorite");

-- CreateIndex
CREATE INDEX "Photo_userId_createdAt_idx" ON "Photo"("userId", "createdAt");
