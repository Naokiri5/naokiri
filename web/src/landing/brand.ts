/**
 * MIA AI V5 brand constants for the public landing page.
 *
 * The corporate Horizon Bear lockups are the official monochrome rasters extracted from Brand Guidelines V3.0
 * (no SVG kit was supplied); they are never tinted, only shown in their approved black or white form.
 * Colors are the mascot-derived web tokens from the V5 master prompt. They style the campaign, never the logo.
 */
export const SLOGAN = 'Trading reimagined for the age of intelligence';

export const BRAND_ASSETS = {
  compactBlack: '/brand/mia-compact-black.webp',
  compactWhite: '/brand/mia-compact-white.webp',
  lockupWhite: '/brand/mia-lockup-slogan-white.webp',
  lockupBlack: '/brand/mia-lockup-slogan-black.webp',
  symbolBlack: '/brand/mia-symbol-black.webp',
  symbolWhite: '/brand/mia-symbol-white.webp',
} as const;

/** AUREUS: the supplied pastel streetwear master render, background removed, never recolored. */
export const MASCOT = {
  src: '/mascot/aureus-988.webp',
  srcSet: '/mascot/aureus-560.webp 560w, /mascot/aureus-988.webp 988w',
  width: 988,
  height: 1416,
  alt: 'AUREUS, the MIA AI mascot: a bear-eared character in a pink cap, pink and sky-blue streetwear jacket, headphones and chunky sneakers, pointing upward.',
} as const;

/** Intrinsic sizes of the official lockups so the browser reserves space (no layout shift). */
export const LOGO_SIZE = { compact: { w: 480, h: 179 }, lockup: { w: 1040, h: 388 }, symbol: { w: 256, h: 248 } } as const;

export const PALETTE = {
  cream: '#FFF5F7',
  pink: '#F48BB8',
  blue: '#8FD3F4',
  lavender: '#8E8196',
  graphite: '#2B2430',
  muted: '#62566B',
  blush: '#FDEAF1',
  ice: '#EAF6FF',
} as const;
