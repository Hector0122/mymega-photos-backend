-- CreateTable
CREATE TABLE "Face" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "encoding" JSONB NOT NULL,
    "boxX" DOUBLE PRECISION NOT NULL,
    "boxY" DOUBLE PRECISION NOT NULL,
    "boxWidth" DOUBLE PRECISION NOT NULL,
    "boxHeight" DOUBLE PRECISION NOT NULL,
    "personName" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Face_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Face_photoId_idx" ON "Face"("photoId");

-- CreateIndex
CREATE INDEX "Face_personName_idx" ON "Face"("personName");

-- CreateIndex
CREATE INDEX "Face_confirmed_ignored_idx" ON "Face"("confirmed", "ignored");

-- AddForeignKey
ALTER TABLE "Face" ADD CONSTRAINT "Face_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
