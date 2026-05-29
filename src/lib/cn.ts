type ClassValue = string | number | null | undefined | false | ClassValue[] | { [key: string]: unknown }

function toClass(value: ClassValue): string {
  if (!value) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(toClass).filter(Boolean).join(' ')
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k)
      .join(' ')
  }
  return ''
}

export function cn(...inputs: ClassValue[]): string {
  return inputs.map(toClass).filter(Boolean).join(' ')
}
