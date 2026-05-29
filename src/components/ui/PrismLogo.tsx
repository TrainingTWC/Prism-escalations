interface PrismLogoProps {
  size?: number
  className?: string
}

/**
 * Prism brand mark — renders the official Prism logo PNG on a transparent background.
 */
export function PrismLogo({ size = 36, className }: PrismLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/prism-logo.png"
      width={size}
      height={size}
      className={className}
      alt="Prism"
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  )
}
