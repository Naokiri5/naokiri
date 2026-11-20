import { lazy } from 'react';
/** Lazy entry points: the Privy SDK is fetched only when Privy is enabled on the server and a panel is shown. */
export type { PrivyClientConfig } from './PrivyPanels';
export const PrivySignIn = lazy(() => import('./PrivyPanels').then((m) => ({ default: m.PrivySignIn })));
export const PrivyAccountCard = lazy(() => import('./PrivyPanels').then((m) => ({ default: m.PrivyAccountCard })));
