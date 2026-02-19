import { env } from "./env";

const supportedLanguageMap: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  ar: "Arabic",
  nl: "Dutch",
  sv: "Swedish",
  tr: "Turkish"
};

function normalize(language: string) {
  return language.trim().toLowerCase();
}

export function getDefaultTopLanguages() {
  const requested = env.TOP_LANGUAGES.split(",").map(normalize).filter(Boolean);
  const filtered = requested.filter((code) => supportedLanguageMap[code]);
  return filtered.length > 0 ? filtered : ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "hi", "ar"];
}

export function getSupportedLanguages() {
  return Object.entries(supportedLanguageMap).map(([code, name]) => ({ code, name }));
}

export function isSupportedLanguage(code: string) {
  return Boolean(supportedLanguageMap[normalize(code)]);
}
