import "dotenv/config";

const numberFromEnv = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: numberFromEnv(process.env.PORT, 8787),
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  realtimeModel: process.env.OPENAI_REALTIME_TRANSLATION_MODEL ?? "gpt-realtime-translate",
  appAccessCode: process.env.APP_ACCESS_CODE ?? "",
  allowedClientIps: process.env.ALLOWED_CLIENT_IPS ?? "",
  sourceLanguage: process.env.SOURCE_LANGUAGE ?? "ja",
  targetLanguage: process.env.TARGET_LANGUAGE ?? "ko",
  sessionMaxMinutes: numberFromEnv(process.env.SESSION_MAX_MINUTES, 60),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
};

export const publicConfig = {
  sourceLanguage: config.sourceLanguage,
  targetLanguage: config.targetLanguage,
  sessionMaxMinutes: config.sessionMaxMinutes
};
