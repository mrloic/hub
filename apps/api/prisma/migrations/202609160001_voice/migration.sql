CREATE TYPE "ChannelType" AS ENUM ('TEXT', 'VOICE');
ALTER TABLE "Channel" ADD COLUMN "type" "ChannelType" NOT NULL DEFAULT 'TEXT';
CREATE TABLE "VoiceLease" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "room" TEXT NOT NULL,
  "revoked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "VoiceLease_id_key" ON "VoiceLease"("id");
CREATE INDEX "VoiceLease_communityId_idx" ON "VoiceLease"("communityId");
CREATE INDEX "VoiceLease_sessionId_idx" ON "VoiceLease"("sessionId");
