import { setLocaleAction } from '@/app/actions/set-locale'
import type { Locale } from '@/lib/i18n/config'
import type { Dictionary } from '@/lib/i18n/types'

interface LanguageSwitchProps {
  locale: Locale
  dictionary: Dictionary
}

/**
 * A real `<form>` posting to a Server Action, not a client component: the
 * two options are native `<button type="submit">`s, so the switch is
 * keyboard-operable and works with JavaScript disabled — no interactivity
 * needs to ship to the browser for this feature.
 */
export function LanguageSwitch({ locale, dictionary }: LanguageSwitchProps) {
  return (
    <form action={setLocaleAction}>
      <fieldset className="flex items-center gap-1 rounded-pill border border-line bg-paper-raised p-1">
        <legend className="sr-only">{dictionary.languageSwitch.label}</legend>
        <LanguageOption value="fr" label={dictionary.languageSwitch.fr} active={locale === 'fr'} />
        <LanguageOption value="en" label={dictionary.languageSwitch.en} active={locale === 'en'} />
      </fieldset>
    </form>
  )
}

function LanguageOption({
  value,
  label,
  active,
}: {
  value: Locale
  label: string
  active: boolean
}) {
  return (
    <button
      type="submit"
      name="locale"
      value={value}
      aria-pressed={active}
      aria-label={label}
      className={
        active
          ? 'rounded-pill bg-primary px-3.5 py-1.5 text-sm font-semibold text-paper'
          : 'rounded-pill px-3.5 py-1.5 text-sm font-semibold text-ink-soft hover:text-ink'
      }
    >
      {value.toUpperCase()}
    </button>
  )
}
