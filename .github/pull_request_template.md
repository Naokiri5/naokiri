## Summary
<!-- What changed and why? -->

## Scope and architecture
- [ ] Existing implementation searched before adding a helper/component/service.
- [ ] Existing canonical modules reused where applicable.
- [ ] No unrelated files or broad reformatting.
- [ ] API contracts and downstream consumers checked.

## Duplication and organization
- [ ] Duplicate candidates reviewed; true duplicates reused/extracted rather than copied.
- [ ] Intentionally separate but similar logic explained.
- [ ] New code has a clear domain owner; no catch-all utils module.

## Safety and data
- [ ] Authentication, authorization and CSRF behavior preserved.
- [ ] Untrusted provider/LLM/user content remains data, not instructions.
- [ ] Paper-only execution and fail-closed trading invariants preserved.
- [ ] Orders, fills, positions, fees, stops and ledger reconcile where relevant.
- [ ] Database migrations are append-only and tested, if applicable.
- [ ] No secrets, credentials, private keys or real account data added.

## Tests and verification
- [ ] Regression tests added/updated.
- [ ] npm run typecheck
- [ ] npm run build
- [ ] npm test
- [ ] npm run test:e2e (when UI flow is affected)
- [ ] npm run scan:secrets
- [ ] npm audit --audit-level=high (when dependency/security scope applies)

Exact commands/results:
Checks not run or still pending:

## Documentation
- [ ] Setup/architecture/API/security docs updated where applicable.
- [ ] Changelog/status claims match verified implementation.
