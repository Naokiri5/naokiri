import type { ReactNode } from 'react';

const icons = {
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  'arrow-up-right': <path d="M6 18 18 6M7 6h11v11" />,
  'arrow-down': <path d="M12 4v15m-6-6 6 6 6-6" />,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
  chart: <><path d="M3 3v17h18M7 14l4-4 4 3 5-7" /><path d="M16 6h4v4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>,
  flask: <><path d="M9 3h6m-5 0v6L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2l-6-10V3M7.5 15h9" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2.6" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  message: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.8-3.3A7.5 7.5 0 1 1 20 11.5Z" /><path d="M9 11.5h6" /></>,
  moon: <path d="M20.2 15.2A8.9 8.9 0 0 1 8.8 3.8 8.9 8.9 0 1 0 20.2 15.2Z" />,
  network: <><circle cx="12" cy="12" r="2.4" /><circle cx="12" cy="4" r="1.6" /><circle cx="5" cy="17" r="1.6" /><circle cx="19" cy="17" r="1.6" /><path d="M12 5.7v3.9m-5.6 6.3 3.7-2.5m7.5 2.5-3.7-2.5" /></>,
  pie: <><path d="M11 3.5a8.5 8.5 0 1 0 9.5 9.5H11V3.5Z" /><path d="M14 3v7h7a8 8 0 0 0-7-7Z" /></>,
  play: <path d="M8 5.5v13l11-6.5L8 5.5Z" />,
  radar: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12 19.7 4.3M12 2v2m0 16v2M2 12h2m16 0h2" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.3 8a7.5 7.5 0 0 1 12.5-2L20 9m-16 6 2.2 3a7.5 7.5 0 0 0 12.5-2" /></>,
  settings: <><path d="M5 6h14M5 12h14M5 18h14" /><path d="M9 4v4m6 2v4m-5 2v4" strokeWidth="2.6" /></>,
  shield: <><path d="M12 3c2.4 2 5 3 8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6c3 0 5.6-1 8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  spark: <><path d="M12 2.5 14.6 9.4 21.5 12l-6.9 2.6-2.6 6.9-2.6-6.9L2.5 12l6.9-2.6L12 2.5Z" /><path d="M5 3v4M3 5h4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {icons[name]}
  </svg>;
}

export function MiaMark({ size = 36 }: { size?: number }) {
  return <svg className="mia-mark" width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true" focusable="false">
    <ellipse cx="18" cy="18" rx="15.7" ry="7.3" transform="rotate(-39 18 18)" stroke="currentColor" strokeWidth="1.4" opacity=".72" />
    <ellipse cx="18" cy="18" rx="15.7" ry="7.3" transform="rotate(39 18 18)" stroke="currentColor" strokeWidth="1.4" />
    <path d="M18 10.3 20.2 15.8 25.7 18 20.2 20.2 18 25.7 15.8 20.2 10.3 18 15.8 15.8 18 10.3Z" fill="currentColor" />
    <circle cx="29" cy="8.1" r="2" fill="currentColor" />
  </svg>;
}

export function MiaWordmark() {
  return <span className="mia-wordmark"><MiaMark /><span>MIA<span className="mia-wordmark-point">.</span></span></span>;
}
