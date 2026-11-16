# Claude Code Workflow for MIA 4.1

The repository includes a shared Claude Code setup:
- CLAUDE.md: project-wide engineering rules and definition of done.
- .claude/rules/: path-specific backend, frontend, trading-safety, database and test guidance.
- .claude/agents/: focused specialist subagents, including read-only safety reviewers.
- .claude/skills/: reusable slash-command workflows.
- .github/workflows/claude.yml: optional, explicit @claude assistance on PR comments.

## Start Claude Code

From the repository root:

    npm ci
    claude

Useful commands:
- /fullstack-delivery <task> — plan, implement, test and independently review a feature.
- /duplication-audit <scope> — find actual duplication and reusable code.
- /safe-refactor <module or concern> — perform a small, behavior-preserving refactor.
- /release-review <branch or PR> — final release-readiness assessment.
- /agents — inspect available agents.
- /doctor — diagnose Claude Code setup.
- /status — confirm active Claude settings.

Start a fresh Claude Code session after adding the first .claude/agents/ folder if it was absent when the session started.

## Ask Claude to continue the current repair PR

Paste this into Claude Code after opening the repository:

    Read CLAUDE.md, docs/CLAUDE_CODE_WORKFLOW.md and docs/REFACTORING_BACKLOG.md.
    Inspect the current branch and git status before editing. Continue from the current repair branch;
    do not reset, force-push, merge or modify main.
    First run /release-review on the current diff and inspect the latest CI result.
    Fix verified build/test failures before structural refactoring.
    Then run /duplication-audit on server/src/api/routes.ts, web/src/pages/Trading.tsx,
    web/src/pages/Intel.tsx and server/src/workers/registry.ts. Produce an evidence-based plan.
    Implement only the highest-priority safe extraction, one module boundary at a time,
    with tests proving behavior and API parity.
    Reuse existing canonical modules. Do not merge the feature indicator engine with
    the worker indicator adapter.
    Preserve all paper-only, risk, order/fill/ledger, auth and migration invariants.
    Run npm run typecheck, npm run build, npm test and relevant Playwright tests.
    Ask the trading-risk and security reviewers to inspect the final diff.
    Leave the work in a draft PR and report exact results.

## Optional GitHub @claude integration

1. Install the official Claude GitHub App on this repository.
2. Add a repository Actions secret named ANTHROPIC_API_KEY (or configure the supported Claude Code OAuth token instead).
3. Ensure GitHub Actions are enabled.
4. Comment @claude on a pull request to request code changes or CI investigation. Only repository write collaborators should trigger it. The workflow is comment-triggered, not automatically invoked on every PR event.
5. Review every resulting commit and CI run. Claude's changes must remain in a branch/PR and must not be merged automatically.

The optional GitHub Action runs on GitHub-hosted runners and may consume Anthropic API usage. Repository files cannot install the GitHub App or add repository secrets for you.

Official references:
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code settings: https://code.claude.com/docs/en/settings
- Claude Code GitHub Action setup: https://github.com/anthropics/claude-code-action
- Action security guidance: https://github.com/anthropics/claude-code-action/blob/main/docs/security.md
