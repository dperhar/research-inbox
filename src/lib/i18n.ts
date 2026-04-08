import en from "../locales/en.json";
import ru from "../locales/ru.json";

const translations: Record<string, Record<string, string>> = { en, ru };

let currentLang = "en";

export function setLanguage(lang: string) {
  currentLang = lang;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = translations[currentLang] || translations.en;
  let text = dict[key] || translations.en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

export function getLanguage(): string {
  return currentLang;
}
