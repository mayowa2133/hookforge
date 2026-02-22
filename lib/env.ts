import { z } from "zod";

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value === "true" || value === "1";
    }
    return defaultValue;
  }, z.boolean());

const EnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(16),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanFromEnv(true),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(250),
  STARTER_CREDITS: z.coerce.number().int().nonnegative().default(1000),
  ENABLE_URL_IMPORT: booleanFromEnv(true),
  ENABLE_PROJECTS_V2: booleanFromEnv(true),
  NEXT_PUBLIC_AI_EDITOR_DEFAULT: booleanFromEnv(true),
  NEXT_PUBLIC_SHOW_TEMPLATES_NAV: booleanFromEnv(false),
  AI_EDITOR_DEFAULT_TEMPLATE_SLUG: z.string().min(1).default("green-screen-commentator"),
  ENABLE_LLM_RECIPE: booleanFromEnv(false),
  OPENAI_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  LIPSYNC_API_KEY: z.string().optional(),
  GENERATIVE_MEDIA_API_KEY: z.string().optional(),
  PUBLIC_API_KEY_SALT: z.string().optional(),
  TOP_LANGUAGES: z.string().default("en,es,fr,de,it,pt,ja,ko,hi,ar"),
  METRICS_NAMESPACE: z.string().default("hookforge")
});

export const env = EnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
  MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB,
  STARTER_CREDITS: process.env.STARTER_CREDITS,
  ENABLE_URL_IMPORT: process.env.ENABLE_URL_IMPORT,
  ENABLE_PROJECTS_V2: process.env.ENABLE_PROJECTS_V2,
  NEXT_PUBLIC_AI_EDITOR_DEFAULT: process.env.NEXT_PUBLIC_AI_EDITOR_DEFAULT,
  NEXT_PUBLIC_SHOW_TEMPLATES_NAV: process.env.NEXT_PUBLIC_SHOW_TEMPLATES_NAV,
  AI_EDITOR_DEFAULT_TEMPLATE_SLUG: process.env.AI_EDITOR_DEFAULT_TEMPLATE_SLUG,
  ENABLE_LLM_RECIPE: process.env.ENABLE_LLM_RECIPE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  LIPSYNC_API_KEY: process.env.LIPSYNC_API_KEY,
  GENERATIVE_MEDIA_API_KEY: process.env.GENERATIVE_MEDIA_API_KEY,
  PUBLIC_API_KEY_SALT: process.env.PUBLIC_API_KEY_SALT,
  TOP_LANGUAGES: process.env.TOP_LANGUAGES,
  METRICS_NAMESPACE: process.env.METRICS_NAMESPACE
});
