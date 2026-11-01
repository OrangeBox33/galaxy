ALTER TABLE "User" ADD COLUMN "hubLimit" INTEGER NOT NULL DEFAULT 5;

-- Старожилам добивка уже ни к чему: у кого больше трёх друзей — лимит 0.
UPDATE "User" SET "hubLimit" = 0
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "aId" AS "id" FROM "Link" UNION ALL SELECT "bId" FROM "Link"
    ) AS "ends"
    GROUP BY "id" HAVING COUNT(*) > 3
);

CREATE TABLE "SuggestionHub" (
    "userId" BIGINT NOT NULL,
    "targetId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionHub_pkey" PRIMARY KEY ("userId","targetId")
);

ALTER TABLE "SuggestionHub" ADD CONSTRAINT "SuggestionHub_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
