-- Ссылки ведут в чат с ботом, а не в Mini App: start_param до приложения
-- больше не доезжает, поэтому токен ждёт здесь между «Запустить» и входом.
CREATE TABLE "PendingStart" (
    "tgUserId" BIGINT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingStart_pkey" PRIMARY KEY ("tgUserId")
);
