import { z } from "zod";
export const loginName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/, "Логин: 3–32 латинских буквы, цифры или _");
export const displayName = z.string().trim().min(1).max(64);
export const name = z.string().trim().min(1).max(80);
export const id = z.string().uuid();
export const credentials = z
  .object({ username: loginName, password: z.string().min(12).max(128) })
  .strict();
export const registration = credentials.extend({ displayName });
export const messageInput = z
  .object({ clientId: id, content: z.string().trim().min(1).max(4000) })
  .strict();
export const inviteInput = z
  .object({
    hours: z.number().int().min(1).max(720),
    maxUses: z.number().int().min(1).max(1000),
  })
  .strict();
export type Role = "OWNER" | "CO_OWNER" | "ADMIN" | "MEMBER";
export type User = { id: string; username: string; displayName: string };
export type Community = { id: string; name: string; role: Role };
export type Channel = {
  id: string;
  name: string;
  communityId: string;
  type: "TEXT" | "VOICE";
};
export type Member = { user: User; userId: string; role: Role };
export type ChatMessage = {
  id: string;
  sequence: string;
  clientId: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: User;
};
export type Invite = {
  id: string;
  url: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
};
export function canManage(role: Role) {
  return role === "OWNER" || role === "CO_OWNER" || role === "ADMIN";
}
export function canKick(actor: Role, target: Role) {
  return (
    target !== "OWNER" &&
    (actor === "OWNER" ||
      (actor === "CO_OWNER" && ["ADMIN", "MEMBER"].includes(target)) ||
      (actor === "ADMIN" && target === "MEMBER"))
  );
}
export function canDeleteMessage(actor: Role, target: Role, own: boolean) {
  return own || actor === "OWNER" || canKick(actor, target);
}

export const channelInput = z
  .object({ name, type: z.enum(["TEXT", "VOICE"]).default("TEXT") })
  .strict();
export const voiceJoinInput = z.object({ channelId: id }).strict();
export const voiceLeaveInput = z.object({ leaseId: id }).strict();
export type VoiceTicket = {
  token: string;
  leaseId: string;
  channelId: string;
  communityId: string;
  channelName: string;
  serverUrl: string;
};

export const roleLabel: Record<Role, string> = {
  OWNER: "Владелец",
  CO_OWNER: "Совладелец",
  ADMIN: "Администратор",
  MEMBER: "Участник",
};
export function canAssignRole(actor: Role, target: Role, next: Role) {
  return (
    target !== "OWNER" &&
    next !== "OWNER" &&
    (actor === "OWNER" ||
      (actor === "CO_OWNER" &&
        ["ADMIN", "MEMBER"].includes(target) &&
        ["ADMIN", "MEMBER"].includes(next)))
  );
}
