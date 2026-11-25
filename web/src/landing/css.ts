import type { CSSProperties } from 'react';

/** Typed helper for inline CSS custom properties (e.g. stagger index `--i`, reveal threshold `--at`). */
export const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;
