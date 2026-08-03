-- CreateTable
CREATE TABLE "tasks" (
    "id" SERIAL NOT NULL,
    "wbs" TEXT NOT NULL DEFAULT '',
    "parentId" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL DEFAULT '',
    "start" TIMESTAMP(3),
    "end" TIMESTAMP(3),
    "durationDays" INTEGER NOT NULL DEFAULT 1,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "owner" TEXT,
    "dependencies" TEXT,
    "descriptionMd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_parentId_idx" ON "tasks"("parentId");

-- CreateIndex
CREATE INDEX "tasks_order_idx" ON "tasks"("order");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
