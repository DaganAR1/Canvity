-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "isAllDay" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CanvasAccount" ADD COLUMN     "connectionType" TEXT NOT NULL DEFAULT 'token',
ADD COLUMN     "encryptedFeedUrl" TEXT,
ALTER COLUMN "encryptedToken" DROP NOT NULL;

