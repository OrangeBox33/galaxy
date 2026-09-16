-- Отказы в окне «возможные друзья»: кого человек однажды отклонил кнопкой «Нет»,
-- тому больше не предлагаться. Отказ односторонний и бессрочный.
CREATE TABLE "SuggestionDismissal" (
    "userId" BIGINT NOT NULL,
    "targetId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionDismissal_pkey" PRIMARY KEY ("userId","targetId")
);

CREATE INDEX "SuggestionDismissal_userId_idx" ON "SuggestionDismissal"("userId");

ALTER TABLE "SuggestionDismissal" ADD CONSTRAINT "SuggestionDismissal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SuggestionDismissal" ADD CONSTRAINT "SuggestionDismissal_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
