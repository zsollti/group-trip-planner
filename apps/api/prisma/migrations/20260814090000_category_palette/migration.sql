-- CreateEnum
CREATE TYPE "CategoryPalette" AS ENUM ('AMBER', 'GOLD', 'LIME', 'JADE', 'SKY', 'INDIGO', 'VIOLET', 'ROSE');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "paletteKey" "CategoryPalette";
