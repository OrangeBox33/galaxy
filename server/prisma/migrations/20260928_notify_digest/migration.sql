-- Уведомления копятся и уходят сводкой не чаще раза в сутки: вместо готового
-- текста строка хранит автора события, имя подставляется при отправке.
ALTER TYPE "OutboxStatus" ADD VALUE 'DROPPED';

ALTER TABLE "User" ADD COLUMN "lastNotifiedAt" TIMESTAMP(3);
UPDATE "User" u SET "lastNotifiedAt" = (
    SELECT max(o."sentAt") FROM "BotOutbox" o WHERE o."userId" = u."id" AND o."status" = 'SENT'
);

DELETE FROM "BotOutbox" WHERE "userId" NOT IN (SELECT "id" FROM "User");
ALTER TABLE "BotOutbox" ADD COLUMN "actorId" BIGINT;
ALTER TABLE "BotOutbox" DROP COLUMN "text";

CREATE INDEX "BotOutbox_userId_status_idx" ON "BotOutbox"("userId", "status");
ALTER TABLE "BotOutbox" ADD CONSTRAINT "BotOutbox_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BotOutbox" ADD CONSTRAINT "BotOutbox_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
