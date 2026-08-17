export const DEFAULT_WIKI_LANGUAGE = 'zh-CN';

export const WIKI_LANGUAGES = Object.freeze([
  { id: 'zh-CN', label: '简体中文', promptName: 'Simplified Chinese' },
  { id: 'en', label: 'English', promptName: 'English' },
  { id: 'ja', label: '日本語', promptName: 'Japanese' },
  { id: 'ko', label: '한국어', promptName: 'Korean' },
  { id: 'fr', label: 'Français', promptName: 'French' },
  { id: 'de', label: 'Deutsch', promptName: 'German' },
  { id: 'es', label: 'Español', promptName: 'Spanish' },
  { id: 'pt-BR', label: 'Português (Brasil)', promptName: 'Brazilian Portuguese' },
]);

const languageById = new Map(WIKI_LANGUAGES.map((language) => [language.id, language]));

export function normalizeWikiLanguage(value, fallback = DEFAULT_WIKI_LANGUAGE) {
  const language = String(value || fallback).trim();
  if (!languageById.has(language)) {
    throw Object.assign(new Error(`language must be one of: ${WIKI_LANGUAGES.map((item) => item.id).join(', ')}`), {
      status: 422,
      code: 'WIKI_LANGUAGE_INVALID',
    });
  }
  return language;
}

export function wikiLanguage(language) {
  return languageById.get(normalizeWikiLanguage(language));
}

export function wikiLanguageInstruction(language) {
  const selected = wikiLanguage(language);
  return `Write every reader-facing Wiki field in ${selected.promptName} (${selected.id}). Keep source titles, proper nouns, URLs, code, and citation identifiers in their original form when translation would reduce accuracy.`;
}
