# AI specialist coordination

Status: implementation design for subsequent increments; not a claim of completion.

Reuse QCI evidence packets, signatures, deadlines, dependency groups, quorum and abstentions. Current workers/challengers are deterministic; Trader Joe is the existing LLM integration. Model specialist calls remain planned. Select relevant specialists under explicit token/request/latency budgets, validate structured outputs and source IDs, and deduplicate evidence. Store concise summaries only. Acceptance: malformed/stale/duplicate packets rejected, timeouts abstain, no agent can place orders, change limits or receive exchange secrets.
