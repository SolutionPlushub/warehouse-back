CREATE TABLE "report_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_conversations_tenantId_userId_updatedAt_idx"
ON "report_conversations"("tenantId", "userId", "updatedAt");

CREATE INDEX "report_messages_conversationId_createdAt_idx"
ON "report_messages"("conversationId", "createdAt");

ALTER TABLE "report_conversations"
ADD CONSTRAINT "report_conversations_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_conversations"
ADD CONSTRAINT "report_conversations_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_messages"
ADD CONSTRAINT "report_messages_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "report_conversations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
