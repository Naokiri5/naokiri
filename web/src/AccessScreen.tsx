import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MiaWordmark } from './brand';
import miaImage from './assets/mia-companion.webp';

export function AccessScreen({ children }: { children: ReactNode }) {
  return <main className="mia-wallet-login">
    <div className="mia-access-frame">
      <Link to="/" className="mia-access-home" aria-label="MIA home"><MiaWordmark /></Link>
      <div className="mia-access-art" aria-hidden="true"><img src={miaImage} alt="" width="1080" height="1080" /></div>
      {children}
    </div>
  </main>;
}
