import { computed } from 'vue'
import { safeLocale, translate, type Params } from '../../shared/i18n-en'
import { useSettingsStore } from '../stores/settings'

function currentLocale(): string {
  return safeLocale(useSettingsStore().value.locale)
}

export function t(key: Parameters<typeof translate>[0], params?: Params): string {
  return translate(key, params, currentLocale())
}

export function useI18n() {
  const locale = computed(currentLocale)
  return {
    locale, t,
    number: (value: number) => new Intl.NumberFormat(locale.value).format(value),
    date: (value: Date) => new Intl.DateTimeFormat(locale.value).format(value),
    duration: (seconds: number) => new Intl.NumberFormat(locale.value, {
      style: 'unit', unit: 'second', unitDisplay: 'short',
    }).format(seconds),
  }
}
