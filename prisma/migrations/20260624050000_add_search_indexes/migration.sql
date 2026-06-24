-- Performance indexes for search and filtering
CREATE INDEX IF NOT EXISTS "Photo_filename_idx" ON "Photo"("filename");
CREATE INDEX IF NOT EXISTS "Photo_tags_idx" ON "Photo" USING GIN ("tags");
CREATE INDEX IF NOT EXISTS "Photo_mimeType_idx" ON "Photo"("mimeType");
