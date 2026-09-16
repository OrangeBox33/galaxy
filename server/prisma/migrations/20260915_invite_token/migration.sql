-- Постоянная личная ссылка-приглашение: одна на человека, не сгорает.
-- Токен короткий (4 знака) и раздаётся приложением при первом же обращении —
-- ensureInviteToken в server/src/lib/inviteLink.ts. В SQL его не генерируем:
-- random() в постгресе не криптографический, а ссылка — это доступ к связи.
ALTER TABLE "User" ADD COLUMN "inviteToken" TEXT;

CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");
