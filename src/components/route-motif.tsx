interface RouteMotifProps {
  fromLabel: string
  toLabel: string
  className?: string
}

/**
 * Decorative dashed-arc "route" motif connecting two nodes — an abstract
 * reference to the Morocco ↔ France connection at the heart of the
 * product, deliberately not using either country's flag colors. Purely
 * decorative: hidden from assistive technology.
 */
export function RouteMotif({ fromLabel, toLabel, className }: RouteMotifProps) {
  return (
    <svg
      viewBox="0 0 620 360"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M40 300 Q 300 60 580 90"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeDasharray="2 10"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="40" cy="300" r="7" fill="var(--color-accent)" />
      <circle cx="580" cy="90" r="7" fill="var(--color-primary)" />
      <text x="10" y="330" fontSize="13" fill="var(--color-ink-soft)">
        {fromLabel}
      </text>
      <text x="500" y="75" fontSize="13" fill="var(--color-ink-soft)">
        {toLabel}
      </text>
    </svg>
  )
}
