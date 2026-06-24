-- CreateIndex
CREATE INDEX "Photo_filename_idx" ON "Photo"("filename");

-- CreateIndex
CREATE INDEX "Photo_mimeType_idx" ON "Photo"("mimeType");

-- CreateIndex
CREATE INDEX "Photo_tags_idx" ON "Photo"("tags");
