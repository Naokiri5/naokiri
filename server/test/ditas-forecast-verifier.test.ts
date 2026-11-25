import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, openDb, all, get, run, J } from '../src/db/db.js';
import { config } from '../src/config.js';
import { acquireOrRenewLease } from '../src/ops/lease.js';
import { market } from '../src/market/store.js';
import { seedInstrument } from './helpers.js';
import { recordOpportunity } from '../src/ditas/memory.js';
import { addForecast, addOutcome, sourceVerifiedCalibration } from '../src/ditas/service.js';
import { verifyDueForecasts } from '../src/ditas/forecastVerifier.js';
import type { Candidate } from '../src/workers/types.js';
const H=3_600_000, T=Date.UTC(2026,10,10,0,0,1), target=Math.ceil(T/H)*H;
let dir:string, file:string, offline:boolean;
function forecast(suffix:string) {
  const {inst}=seedInstrument('BTCUSDT',{drift:0,vol:0});
  const candidate:Candidate={id:'cand-'+suffix,eventId:'event-'+suffix,traceId:'trace-'+suffix,instrumentId:inst.id,symbol:inst.symbol,base:inst.base,market:inst.market,venue:inst.venue,strategyId:'trend_pullback',strategyVersion:'1.0.0',interval:'1h',regime:'TREND_UP',createdAt:Date.now(),signal:{direction:'long',entryRef:100,stop:95,targets:[{r:2,fraction:1}],maxHoldBars:10,trailAfterR:null,trigger:'fixture',invalidation:'fixture',reasons:['fixture']}};
  const event=recordOpportunity({kind:'PROPOSAL',instrumentId:inst.id,dedupeKey:'forecast-'+suffix,reason:'fixture',candidate});
  return addForecast(event.id,.75,target,100,'model-'+suffix,'prompt-v1');
}
function response(closeTime=target-1) { return new Response(JSON.stringify([[target-H,'100','115','90','110','5',closeTime]])); }
beforeEach(()=>{
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(T);
  offline=config.offline;config.offline=false;
  closeDb();dir=mkdtempSync(join(tmpdir(),'mia-forecast-'));file=join(dir,'mia.db');openDb(file);market.reset();
});
afterEach(()=>{ closeDb();rmSync(dir,{recursive:true,force:true});config.offline=offline;market.reset();vi.unstubAllGlobals();vi.useRealTimers(); });
describe('canonical DITAS source forecast settlement',()=>{
  it('persists provider-backed outcomes across restart without trading or duplicate settlement',async()=>{
    const f=forecast('restart');vi.setSystemTime(target+3000);
    const lease=acquireOrRenewLease('engine','leader',60_000)!;
    const fetch=vi.fn(async()=>response());vi.stubGlobal('fetch',fetch);
    expect(await verifyDueForecasts(lease)).toMatchObject({settled:1});
    expect(String(fetch.mock.calls.length)).toBe('1');
    closeDb();openDb(file);
    expect(sourceVerifiedCalibration(f.cohort)).toMatchObject({sample:1,brierScore:.0625,tradingAuthority:false});
    expect(await verifyDueForecasts(lease)).toMatchObject({settled:0});
    expect(get('SELECT COUNT(*) n FROM ditas_outcomes')).toMatchObject({n:1});
    for(const table of ['orders','fills','positions','ledger_entries']) expect(all('SELECT * FROM '+table)).toHaveLength(0);
  });
  it('does not settle wrong-time bars or overwrite owner observations',async()=>{
    const f=forecast('wrong');vi.setSystemTime(target+3000);
    const lease=acquireOrRenewLease('engine','leader',60_000)!;
    vi.stubGlobal('fetch',vi.fn(async()=>response(target)));
    expect(await verifyDueForecasts(lease)).toMatchObject({settled:0,deferred:1});
    addOutcome(f.id,90,target,'owner fixture');
    expect(await verifyDueForecasts(lease)).toMatchObject({settled:0});
    expect(sourceVerifiedCalibration(f.cohort).sample).toBe(0);
  });
  it('rejects settlement after lease takeover during network I/O',async()=>{
    forecast('fence');vi.setSystemTime(target+3000);
    const lease=acquireOrRenewLease('engine','old',10)!;
    vi.stubGlobal('fetch',vi.fn(async()=>{
      vi.setSystemTime(target+3020);acquireOrRenewLease('engine','new',60_000);
      return response();
    }));
    await expect(verifyDueForecasts(lease)).rejects.toThrow('engine lease lost');
    expect(all('SELECT * FROM ditas_outcomes')).toHaveLength(0);
  });
});
