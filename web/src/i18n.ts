import i18next from 'i18next';
import en from './locales/en.json' with { type: 'json' };

export const i18n = i18next.createInstance();

void i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
