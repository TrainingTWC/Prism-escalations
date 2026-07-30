interface PrismLogoProps {
  size?: number
  className?: string
}

export function PrismLogo({ size = 36, className }: PrismLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/prism-logo.png?v=2"
      width={size}
      height={size}
      className={className}
      alt="Prism"
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  )
}
