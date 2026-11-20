# MIA Autopilot: preserved requirements and implementation handoff

Start here, Claude or Codex. The uploaded documents are preserved verbatim in `sources/`; `SOURCE_MANIFEST.json` records their sizes and SHA256 hashes. `TICKET_CONTRACTS.json` indexes every original001–100 contract and all45 questions. These are specifications, not proof of implemented features or permission to merge/deploy/trade/withdraw.

Read the three `TICKETS_*` inventories and three `QUESTIONS_*` answers before changing existing services. Their statuses describe the frozen PR7 baseline; the milestone report separately records delivered changes and executed tests. Do not rewrite existing navigation, Trader Joe, scanner, risk, OMS, ledger, authentication or knowledge services just because the blueprint's illustrative path differs.

Baseline: Claude integration PR7 at b624b52d7dc0bc87310e92193e8da276286b8976. It already includes PR8's execution report, prior DITAS/chart work, six-section navigation, global Trader Joe and Quant Academy. This branch adds only the selected compact UI/monitor slice and its canonical request correctness prerequisite. It does not replace or merge the integration branch.

For implementation/review read `MILESTONE_CONTRACT.md`, `MILESTONE_REVIEW.md`, `SECURITY_REVIEW.md` and `IMPLEMENTATION_REPORT.md`. Native PiP capability and mocked lifecycle evidence must be distinguished. No24-hour paper soak, off-host hosting, backup restoration, live certification, signing or actual payout is implied.

Continue with one accepted, testable increment at a time. Use existing `.claude/agents` and project rules where available; agents/tools here did not directly message or run a separate Claude model. Collaboration is through preserved source inputs, actual Claude-authored branch ancestry and this handoff. No external AI credentials are needed for this UI slice.

Integration update: before publication this increment was rebased onto Claude commit `1f1aa5f5a1c39f3b3981c3c75415d316dfac9432`. Preserve its StatusRibbon, monotonic request-start freshness, setup-code authentication, honest sign-out and supervisor/backup work. The inventories above remain a historical assessment of `b624b52`; they are not a current inventory of the later integrated branch. Consult `docs/engineering/AUTOPILOT_100_INVENTORY.md` and the newer audit/soak reports alongside them. The duplicate History implementation was dropped in favor of Claude’s fix; this branch retains its regression test.
