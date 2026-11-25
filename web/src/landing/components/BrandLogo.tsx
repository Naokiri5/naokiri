import { BRAND_ASSETS, LOGO_SIZE, SLOGAN } from '../brand';

type Variant = 'compact' | 'lockup' | 'symbol';
type Tone = 'black' | 'white';

/**
 * The official Horizon Bear mark, used as supplied: pure black on light surfaces, pure white on dark ones.
 * Never tinted, filtered, shadowed or re-drawn. Clear space is applied by the parent via padding.
 */
export function BrandLogo({ variant, tone, width, className }: { variant: Variant; tone: Tone; width: number; className?: string }) {
  const src = variant === 'compact' ? (tone === 'black' ? BRAND_ASSETS.compactBlack : BRAND_ASSETS.compactWhite)
    : variant === 'lockup' ? (tone === 'black' ? BRAND_ASSETS.lockupBlack : BRAND_ASSETS.lockupWhite)
      : (tone === 'black' ? BRAND_ASSETS.symbolBlack : BRAND_ASSETS.symbolWhite);
  const size = LOGO_SIZE[variant];
  const alt = variant === 'lockup' ? `MIA AI — ${SLOGAN}` : variant === 'symbol' ? 'MIA AI Horizon Bear' : 'MIA AI';
  return <img className={className} src={src} alt={alt} width={width} height={Math.round((width * size.h) / size.w)} decoding="async" />;
}
