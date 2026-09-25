-- Первый вход: окно профиля и рождение звезды. Всем, кто уже заходил,
-- ставим true — рождение показывается только новым и заведённым заранее.
ALTER TABLE "User" ADD COLUMN "bornSeen" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "bornSeen" = true;

-- Личные цвета: внутренний диск и языки пламени. null — звезда белая.
ALTER TABLE "User" ADD COLUMN "coreColor" TEXT;
ALTER TABLE "User" ADD COLUMN "flameColor" TEXT;
