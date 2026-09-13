-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "telegramFirstName" TEXT,
    "telegramLastName" TEXT,
    "languageCode" TEXT,
    "customName" TEXT,
    "nameLockedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "age" INTEGER,
    "gender" "Gender" NOT NULL DEFAULT 'UNSPECIFIED',
    "avatarFile" TEXT,
    "avatarFetchedAt" TIMESTAMP(3),
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "degree" INTEGER NOT NULL DEFAULT 0,
    "centrality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "aId" BIGINT NOT NULL,
    "bId" BIGINT NOT NULL,
    "createdById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "inviterId" BIGINT NOT NULL,
    "label" TEXT,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "acceptedById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotOutbox" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "BotOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAudit" (
    "id" TEXT NOT NULL,
    "adminId" BIGINT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "params" JSONB NOT NULL,
    "dirty" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LayoutState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_isTest_idx" ON "User"("isTest");

-- CreateIndex
CREATE INDEX "Link_aId_idx" ON "Link"("aId");

-- CreateIndex
CREATE INDEX "Link_bId_idx" ON "Link"("bId");

-- CreateIndex
CREATE UNIQUE INDEX "Link_aId_bId_key" ON "Link"("aId", "bId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_inviterId_status_idx" ON "Invite"("inviterId", "status");

-- CreateIndex
CREATE INDEX "BotOutbox_status_createdAt_idx" ON "BotOutbox"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_aId_fkey" FOREIGN KEY ("aId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_bId_fkey" FOREIGN KEY ("bId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

