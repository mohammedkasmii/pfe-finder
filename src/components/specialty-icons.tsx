import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const shared: IconProps = {
  width: 26,
  height: 26,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

export function SoftwareIcon(props: IconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 5l-2 14" />
    </svg>
  )
}

export function DataIcon(props: IconProps) {
  return (
    <svg {...shared} {...props}>
      <circle cx="12" cy="6" r="2.4" />
      <circle cx="6" cy="17" r="2.4" />
      <circle cx="18" cy="17" r="2.4" />
      <path d="M12 8.4V13M9.8 15.5 6 17M14.2 15.5 18 17" />
    </svg>
  )
}

export function SecurityIcon(props: IconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M12 3l7 3v6c0 5-3.2 7.5-7 9-3.8-1.5-7-4-7-9V6l7-3z" />
    </svg>
  )
}

export function CloudIcon(props: IconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7-1.7A4 4 0 0 0 7 18z" />
    </svg>
  )
}

export function NetworkIcon(props: IconProps) {
  return (
    <svg {...shared} {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
      <path d="M11 7.5h2M7.5 11v2" />
    </svg>
  )
}

export function QaIcon(props: IconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}
