-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'QR_CODE', 'CONNECTED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "instances" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "webhookToken" TEXT,
    "status" "InstanceStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "phone" TEXT,
    "profileName" TEXT,
    "profilePic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "response" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instances_name_key" ON "instances"("name");

-- CreateIndex
CREATE UNIQUE INDEX "instances_token_key" ON "instances"("token");

-- CreateIndex
CREATE INDEX "messages_instanceId_idx" ON "messages"("instanceId");

-- CreateIndex
CREATE INDEX "messages_remoteJid_idx" ON "messages"("remoteJid");

-- CreateIndex
CREATE INDEX "webhook_logs_instanceId_idx" ON "webhook_logs"("instanceId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
