import Image from 'next/image'

interface PrismLogoProps {
  size?: number
  className?: string
}

/**
 * Prism brand mark — renders the official Prism logo PNG on a transparent background.
 * Uses next/image so basePath/assetPrefix are applied correctly on GitHub Pages.
 */
export function PrismLogo({ size = 36, className }: PrismLogoProps) {
  return (
    <Image
      src="/prism-logo.png"
      width={size}
      height={size}
      className={className}
      alt="Prism"
      style={{ width: size, height: size, objectFit: 'contain' }}
      priority
    />
  )
}
