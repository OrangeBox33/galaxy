ALTER TABLE "User" ADD COLUMN "maxId" BIGINT;

CREATE UNIQUE INDEX "User_maxId_key" ON "User"("maxId");
