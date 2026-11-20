# Engineering reviews

This directory is the entry point for current code-review follow-ups. Keep historical audit files in place, and record each later review against an exact branch/commit so an old open finding is not mistaken for a current defect.

- [2026-11-20: CodeRabbit reconciliation and functional repairs](2026-11-20/REPORT.md): all 73 then-unresolved threads classified, regression evidence, module ownership, backtest validation and remaining limits.
- [Machine-readable findings](2026-11-20/CODERABBIT_FINDINGS.json): original PR/comment links, current-code disposition and evidence. GitHub resolution flags are not edited by this work.
- [Tracked-file inventory](2026-11-20/FILE_INVENTORY.json): paths and sizes for repository navigation. Inventory is not proof of exhaustive line-by-line review.

Use `server/src/features` for indicators, `market` for provider data/quality, `decision` and `risk` for authorization evidence/vetoes, `exec` for paper orders, `portfolio` for accounting, and `lab` for strategy replay. Frontend requests belong to `web/src/api.ts`; shared controls belong to `web/src/ui.tsx`. Fix a defect in its existing domain rather than adding a parallel engine or generic catch-all helper.
