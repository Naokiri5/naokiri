import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { AccessScreen } from './AccessScreen';
import Landing from './Landing';

const ProtectedApp = lazy(() => import('./ProtectedApp'));

export default function App() {
  const { pathname } = useLocation();
  if (pathname === '/') return <Landing />;
  return <Suspense fallback={<AccessScreen><div className="mia-wallet-card" role="status">Connecting to MIA…</div></AccessScreen>}>
    <ProtectedApp />
  </Suspense>;
}
