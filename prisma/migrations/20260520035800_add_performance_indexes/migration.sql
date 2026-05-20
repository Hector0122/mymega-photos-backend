-- CreateIndex
CREATE INDEX "Album_userId_vault_idx" ON "Album"("userId", "vault");

-- CreateIndex
CREATE INDEX "Photo_userId_deletedAt_idx" ON "Photo"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "Photo_userId_deletedAt_createdAt_idx" ON "Photo"("userId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Photo_userId_deletedAt_private_idx" ON "Photo"("userId", "deletedAt", "private");

-- CreateIndex
CREATE INDEX "Photo_userId_blurred_idx" ON "Photo"("userId", "blurred");

-- CreateIndex
CREATE INDEX "Photo_perceptualHash_idx" ON "Photo"("perceptualHash");
