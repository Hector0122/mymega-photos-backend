/*
  Warnings:

  - Added the required column `filename` to the `Photo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mimeType` to the `Photo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `size` to the `Photo` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "filename" TEXT NOT NULL,
ADD COLUMN     "mimeType" TEXT NOT NULL,
ADD COLUMN     "size" INTEGER NOT NULL;
