-- AlterTable
ALTER TABLE "SyllabusItem" ADD COLUMN     "isAllDay" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'UTC';

