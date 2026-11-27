import joeImage from '../../assets/trader-joe.webp';

/**
 * Static Trader Joe artwork. Shown while the 3D studio loads, when WebGL is unavailable or fails, and on devices
 * where the owner prefers reduced data. Every control around the studio stays usable without it.
 */
export function JoeFallback({ caption }: { caption?: string }) {
  return <div className="mia-joe-fallback">
    <img src={joeImage} alt="Trader Joe at his workstation" width="800" height="800" />
    {caption && <span className="hint">{caption}</span>}
  </div>;
}
