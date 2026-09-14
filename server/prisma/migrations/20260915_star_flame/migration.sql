-- Личный множитель числа языков пламени: 0.55…1 с шагом 0.05.
ALTER TABLE "User" ADD COLUMN "flame" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- Тем, кто уже зарегистрирован, раздаём значения из того же набора:
-- иначе у всех старожилов звёзды горели бы одинаково.
UPDATE "User" SET "flame" = 0.55 + floor(random() * 10) * 0.05;
