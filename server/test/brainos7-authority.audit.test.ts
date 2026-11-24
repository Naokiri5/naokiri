import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Boundary lint for newly introduced research-only cognitive modules.
 * The repository's TS 7 compiler package does not export the previous JS AST API,
 * so this test uses tightly scoped source checks rather than a fake AST claim.
 * Existing financial modules are excluded because they must legitimately mutate OMS.
 */
const root=fileURLToPath(new URL('../src/knowledge/cognitive/',import.meta.url));
const files=readdirSync(root).filter(s=>s.endsWith('.ts'));
const forbiddenImports=[
  /(?:^|\/)exec(?:\/|\.js$)/,
  /(?:^|\/)risk\//,
  /(?:^|\/)wallet\//,
  /(?:^|\/)portfolio\//,
  /(?:^|\/)security\//,
];
const forbiddenCalls=/\b(?:placeOrder|submitEntry|submitOrder|cancelOrder|cancelAllOpenOrders|closePosition|forceExit|setLeverage|reserveCapitalEnvelope|recordFill|ledger|acceptPolicy|setStrategyStatus|updateControl|openDb|triggerSweep|mutateRisk|commitLedgerEntry|executeTreasurySweep)\s*\(/g;
const authorityEscalation=/\b(?:financialAuthority|executionAuthority|canRequestFinancialAction)\s*:\s*true\b/g;
describe('BrainOS 7 research-only single-authority source audit',()=>{
  it('includes all cognitive modules in the audit',()=>expect(files.length).toBeGreaterThanOrEqual(7));
  for(const filename of files) {
    it(filename+' contains no forbidden execution integration',()=>{
      const original=readFileSync(join(root,filename),'utf8');
      const imports=[...original.matchAll(/\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)]
        .map(x=>x[1]);
      expect(imports.filter(p=>forbiddenImports.some(re=>re.test(p)))).toEqual([]);
      const stripped=original
        .replace(/\/\*[\s\S]*?\*\//g,'')
        .replace(/^\s*\/\/.*$/gm,'')
        .replace(/(['"`])(?:\\.|(?!\1)[^\\])*?\1/g,'');
      expect([...stripped.matchAll(forbiddenCalls)].map(x=>x[0])).toEqual([]);
      expect([...stripped.matchAll(authorityEscalation)].map(x=>x[0])).toEqual([]);
    });
  }
});
