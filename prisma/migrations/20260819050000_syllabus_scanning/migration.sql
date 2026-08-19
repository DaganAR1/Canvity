-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "syllabusError" TEXT,
ADD COLUMN     "syllabusHash" TEXT,
ADD COLUMN     "syllabusScannedAt" TIMESTAMP(3),
ADD COLUMN     "syllabusSource" TEXT;

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "syllabusItemId" TEXT,
ALTER COLUMN "assignmentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SyllabusItem" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "date" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "importance" TEXT NOT NULL DEFAULT 'medium',
    "sourceQuote" TEXT,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priorityTier" TEXT NOT NULL DEFAULT 'normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyllabusItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyllabusItem_courseId_idx" ON "SyllabusItem"("courseId");

-- CreateIndex
CREATE INDEX "SyllabusItem_date_idx" ON "SyllabusItem"("date");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_userId_syllabusItemId_channel_kind_key" ON "NotificationLog"("userId", "syllabusItemId", "channel", "kind");

-- AddForeignKey
ALTER TABLE "SyllabusItem" ADD CONSTRAINT "SyllabusItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_syllabusItemId_fkey" FOREIGN KEY ("syllabusItemId") REFERENCES "SyllabusItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

