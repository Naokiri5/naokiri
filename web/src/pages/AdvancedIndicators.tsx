import type { AdvancedIndicatorSnapshot } from '../../../server/src/features/indicators';
import { fmt } from '../api';
import { Card } from '../ui';

function volatility(value: number | null) {
  return value === null ? '—' : `${fmt.num(value * 100, 2)}%`;
}

export function AdvancedIndicators({ snapshot }: { snapshot: AdvancedIndicatorSnapshot | null | undefined }) {
  if (!snapshot) return null;
  const { wma20, hma20, keltner, ichimoku, parabolicSar, parkinson20, garmanKlass20 } = snapshot;
  const offset = ichimoku.displacementBars;
  const rows = [
    ['Weighted moving average (20)', fmt.px(wma20)],
    ['Hull moving average (20)', fmt.px(hma20)],
    ['Keltner lower / middle / upper', keltner ? [keltner.lower, keltner.middle, keltner.upper].map(fmt.px).join(' / ') : '—'],
    ['Ichimoku conversion (9)', fmt.px(ichimoku.conversion9)],
    ['Ichimoku base (26)', fmt.px(ichimoku.base26)],
    [`Ichimoku leading A (+${offset} bars)`, fmt.px(ichimoku.leadingA)],
    [`Ichimoku leading B (+${offset} bars)`, fmt.px(ichimoku.leadingB52)],
    [`Ichimoku lagging close (−${offset} bars)`, fmt.px(ichimoku.laggingClose)],
    ['Parabolic SAR', parabolicSar ? `${fmt.px(parabolicSar.value)} · ${parabolicSar.trend === 'UP' ? 'Uptrend' : 'Downtrend'}` : '—'],
    ['Parkinson volatility (20, per bar)', volatility(parkinson20)],
    ['Garman–Klass volatility (20, per bar)', volatility(garmanKlass20)],
  ];

  return <Card title="Advanced indicators" right={<span className="hint">Closed candles</span>} flush>
    <div className="tablewrap">
      <table><tbody>
        {rows.map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td className="num">{value}</td></tr>)}
      </tbody></table>
    </div>
  </Card>;
}
