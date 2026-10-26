export const voiceConfig = {
  enabled: process.env.VOICE_ENABLED === "true",
  url: process.env.LIVEKIT_URL ?? "http://livekit:7880",
  key: process.env.LIVEKIT_API_KEY ?? "",
  secret: process.env.LIVEKIT_API_SECRET ?? "",
};
if (
  voiceConfig.enabled &&
  (voiceConfig.key.length < 8 || voiceConfig.secret.length < 32)
)
  throw new Error("Для голоса требуются LIVEKIT_API_KEY и LIVEKIT_API_SECRET");
