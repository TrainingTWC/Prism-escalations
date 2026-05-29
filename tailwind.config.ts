import type { Config } from 'tailwindcss'

/**
 * Tailwind v4 reads design tokens from `@theme { ... }` blocks in
 * `src/app/globals.css`. This file remains only to declare content sources
 * for IDE tooling — color/font/radius tokens live in CSS.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: { extend: {} },
  plugins: [],
}

export default config
