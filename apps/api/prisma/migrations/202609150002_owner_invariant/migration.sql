-- At most one owner, in addition to application community-row serialization.
CREATE UNIQUE INDEX "Membership_one_owner" ON "Membership" ("communityId") WHERE role = 'OWNER';
ALTER TABLE "Message" ADD CONSTRAINT "Message_deleted_content_empty" CHECK ("deletedAt" IS NULL OR content = '');
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_uses_valid" CHECK (uses >= 0 AND uses <= "maxUses" AND "maxUses" > 0);
