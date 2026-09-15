import type { Dictionary } from '@/lib/i18n/types'

interface FreshnessBannerProps {
  dictionary: Dictionary
}

export function FreshnessBanner({ dictionary }: FreshnessBannerProps) {
  const { staleTitle, staleBody } = dictionary.offers.freshness
  return (
    <div role="status" className="mb-6 rounded-md border border-accent/40 bg-accent/10 p-4 text-sm text-accent-dark">
      <p className="font-semibold">{staleTitle}</p>
      <p className="mt-1">{staleBody}</p>
    </div>
  )
}
