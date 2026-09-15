interface ApplyLinkProps {
  href: string | null
  label: string
  unavailableLabel: string
}

/**
 * Renders an external application link only when it's a genuine
 * `https://` URL. `href` has already been re-validated against the
 * offer's source allowlist (src/lib/offers/public-offer.ts), but this
 * component asserts `https://` again as a last line of defense before
 * ever emitting an anchor (docs/SECURITY.md: "Accept application and
 * source links only when HTTPS and allowlisted. Open external links with
 * noopener noreferrer.").
 */
export function ApplyLink({ href, label, unavailableLabel }: ApplyLinkProps) {
  if (!href || !href.startsWith('https://')) {
    return <p className="text-sm text-ink-muted">{unavailableLabel}</p>
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block rounded-pill bg-primary px-5 py-2.5 text-sm font-semibold text-paper hover:bg-primary-dark"
    >
      {label}
    </a>
  )
}
