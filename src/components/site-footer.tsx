import type { Dictionary } from '@/lib/i18n/types'

interface SiteFooterProps {
  dictionary: Dictionary
}

export function SiteFooter({ dictionary }: SiteFooterProps) {
  const { footer } = dictionary
  return (
    <footer className="border-t border-line px-6 py-8 text-sm text-ink-muted sm:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>{footer.copyright}</p>
        <p>{footer.attributionNote}</p>
      </div>
    </footer>
  )
}
