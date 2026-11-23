import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * AST audit limited to new cognitive source files. Existing financial owners
 * legitimately import and call the OMS and risk gate; auditing them as cognitive
 * modules would generate false positives and undermine the single-owner design.
 */
const root=fileURLToPath(new URL('../src/knowledge/cognitive/',import.meta.url));
const files=readdirSync(root).filter(s=>s.endsWith('.ts'));
const forbiddenPath=/(?:^|\/)(?:exec|risk|wallet|portfolio)(?:\/|$)|(?:^|\/)security\//;
const forbiddenCalls=new Set([
  'placeOrder','submitEntry','submitOrder','cancelOrder','closePosition',
  'setLeverage','reserveCapitalEnvelope','recordFill','ledger','run','tx',
  'acceptPolicy','setStrategyStatus','updateControl','openDb','triggerSweep',
]);
describe('BrainOS 7 financial single-authority source boundary',()=>{
  it('has cognitive modules to audit',()=>{
    expect(files.length).toBeGreaterThanOrEqual(7);
  });
  for(const filename of files) {
    it(filename+' cannot import financial mutation owners or invoke order mutations',()=>{
      const source=readFileSync(join(root,filename),'utf8');
      const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
      const problems:string[]=[];
      const visit=(node:ts.Node)=>{
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          if(forbiddenPath.test(node.moduleSpecifier.text))
            problems.push('FORBIDDEN_IMPORT:'+node.moduleSpecifier.text);
        }
        if(ts.isCallExpression(node)) {
          const expr=node.expression;
          const name=ts.isIdentifier(expr)?expr.text:
            ts.isPropertyAccessExpression(expr)?expr.name.text:'';
          if(forbiddenCalls.has(name)) problems.push('FORBIDDEN_CALL:'+name);
          if(name==='eval' || name==='Function' || name==='require')
            problems.push('DYNAMIC_EVALUATION:'+name);
        }
        if(ts.isPropertyAssignment(node) && (
          (ts.isIdentifier(node.name)&&['financialAuthority','executionAuthority',
            'canRequestFinancialAction'].includes(node.name.text)))) {
          if(node.initializer.kind===ts.SyntaxKind.TrueKeyword)
            problems.push('FINANCIAL_AUTHORITY_ESCALATION:'+node.name.getText(ast));
        }
        ts.forEachChild(node,visit);
      };
      visit(ast);
      expect(problems).toEqual([]);
    });
  }
});
