# MIA Quantitative Trading Intelligence Academy — Architecture

The Academy is MIA's persistent knowledge and research subsystem. It lives in one folder,
`server/src/knowledge/`, plus one page, `web/src/pages/Academy.tsx` (route `/academy`). It reuses MIA's database,
audit log, event bus, backtester, strategy capsules, regime classifier, candle provider and paper ledger. It does not
rebuild any of them.

**Authority boundary.** Knowledge is evidence. No passage, concept, claim, experiment or memory record is read by the
QCI coordinator, the decision engine's verdict, the risk gate or the OMS when they decide. The decision report carries
`knowledge.refs` for explanation only. Trader Joe's `search_knowledge` tool is read-only, and its passages are labelled
as untrusted text.

## Modules (`server/src/knowledge/`)

| File | Responsibility |
|---|---|
| `taxonomy.ts` | 12 disciplines, 6 evidence classes, the 20-title priority catalog, 19 curated concept cards, strategy→concept and worker-domain→concept maps |
| `extract.ts` | Untrusted-document extraction: PDF (pdfjs-dist, eval disabled), EPUB, DOCX (custom ZIP reader with zip-bomb limits), HTML (scripts/forms stripped), Markdown, TXT. Detects the format from magic bytes. Fails with a coded `ExtractionError` and never returns invented text. DRM is refused, never bypassed. |
| `chunk.ts` | Deterministic, structure-aware chunking. Detects chapters, headings, equations, tables and reference lists, and keeps page ranges. A chunk never crosses a chapter boundary. |
| `store.ts` | Upload (sha256 de-duplication; the original bytes are stored unmodified), a sequential queue, resumable PDF processing in 40-page batches, reprocessing, metadata edits with history, catalog, measured statistics |
| `providers.ts` | Provider-independent interfaces. The embedding provider is `local-hash-v1`, a 512-dimension hashed lexical vector that is labelled `semantic:false`. The reasoning provider is Claude, used only if `ANTHROPIC_API_KEY` is set; passages are fenced as untrusted, and each `[n]` citation is validated against the supplied passages. |
| `search.ts` | Keyword (FTS5 BM25), vector and hybrid (reciprocal-rank fusion, k=60) search, with filters for document, author, discipline, chapter, concept and evidence class. Also provides citations and "what does the research say" answers (extractive without an LLM). |
| `concepts.ts` | Concept cards, passage→concept linking, AUTO_CANDIDATE claims, owner claims (the quote must match the passage verbatim), conflict detection (disagreement is kept side by side, never merged) and Part 5D research specs |
| `research.ts` | Research laboratory (described in the next section) |
| `memory.ts` | Memory categories A–F mapped onto the existing tables, with freshness and mutability policies (no second memory store) |
| `integration.ts` | Read-only bridges: decision-report knowledge references, worker-domain concepts and the Trader Joe tool |
| `routes.ts` | `/api/academy/*`. Registered inside the authenticated API plugin, so it inherits the session check and the CSRF header requirement. |

### Research laboratory (`research.ts`)

- **Candle store.** Candles are kept in `research_candles`, which is refreshed from Binance public klines when MIA is
  online. The lab refuses a series that has gaps, and it uses only closed candles.
- **Experiments.** Three are available:
  - `volatility_clustering`: ACF of |r| at lags 1–10, a 200-run seeded shuffle null, Ljung–Box on |r|, r² and r, and
    a stability check across a first/second-half split.
  - `return_autocorrelation`: lag 1–5 autocorrelation, a two-sided shuffle test and the half-split check.
  - `strategy_walkforward`: one point-in-time backtest of a strategy capsule with fixed parameters, split into 1
    warm-up window and 5 out-of-sample windows. Trades that cross a window boundary are purged, the first 24 bars
    after each boundary are embargoed, and the run reports a buy-and-hold benchmark and a per-regime breakdown.
- **Metrics.** Net return, CAGR, volatility, annualized Sharpe and Sortino, maximum drawdown, Calmar, profit factor,
  win rate, expectancy with a bootstrap 95% CI, turnover, exposure and CVaR(5%). Costs include fees, spread and
  slippage.
- **Immutable records.** Each run is stored with its data hash, seed, code version, trial number (to show repeated
  testing) and a content hash. An SQLite trigger blocks updates. `experimentDetail` re-verifies the content hash.
- **Other features.** A strategy-comparison run puts every capsule on identical data and costs. A 90-day paper
  experiment tracker reads the real paper positions.

## Data model (migration 3, append-only)

The tables are:
- Library: `kb_documents`, `kb_document_files` (original bytes), `kb_document_events`
- Passages and search: `kb_chunks`, `kb_chunks_fts` (FTS5), `kb_embeddings`
- Concepts: `kb_catalog`, `kb_concepts`, `kb_concept_sources`, `kb_claims`
- Research: `research_experiments` (immutable), `research_candles`

Document statuses are `INGESTION_PENDING`, `PROCESSING`, `INDEXED`, `PARTIALLY_INDEXED`, `NEEDS_REVIEW` and `FAILED`.
Catalog titles without a document show `AWAITING_DOCUMENT`. A title is never shown as read unless its passages are
committed.

## API (`/api/academy`, owner session; non-GET requests need `x-mia-csrf: 1`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/stats`, `/disciplines`, `/catalog`, `/memory`, `/domain-concepts`, `/candles`, `/paper-experiment` | Read-only views (counts are measured) |
| POST | `/catalog/import` | Add catalog titles (validated discipline; duplicates skipped) |
| POST | `/documents` | Upload the raw bytes as `application/octet-stream`, with the `x-filename` header and optional `catalogId`, `discipline`, `evidenceClass` query parameters. Size limit: `MIA_KB_MAX_UPLOAD_MB`. |
| GET | `/documents`, `/documents/:id` | Library, failures, processing history, chapters |
| POST | `/documents/:id/reprocess` | Re-extract with the current extractor; the original file is kept |
| PATCH | `/documents/:id` | Owner metadata correction (logged as before/after) |
| GET | `/search?q=&mode=keyword\|semantic\|hybrid` (+ filters) | Passages with sources |
| POST | `/ask` | Extractive answer, or an LLM answer with validated citations; includes concepts and disagreements |
| GET | `/citations/:chunkId` | Full passage with its source |
| GET/POST | `/concepts`, `/concepts/:id`, `/claims`, `/conflicts`, `/concepts/:id/research-spec` | Concepts, claims and disagreements |
| POST/GET | `/experiments`, `/experiments/:id`, `/strategy-comparison` | Research runs (owner only) |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MIA_KB_MAX_UPLOAD_MB` | 60 | Maximum upload size |
| `MIA_KB_EMBEDDINGS` | `local-hash-v1` | Embedding provider id. Unknown ids fail loudly; nothing degrades silently. |
| `ANTHROPIC_API_KEY` | unset | Enables LLM answers. Without it, answers are extractive. |

## Backup and rollback

Back up the SQLite file in `MIA_DATA_DIR`. The original documents are inside it (`kb_document_files`), so passages,
embeddings and links can always be rebuilt with **Re-process**. Rolling back the code to a build before migration 3
leaves the new tables unused; no existing table was altered.

## Limitations (honest)

- The vectors are lexical, not semantic. True semantic search needs an embedding provider; the interface exists, and
  only `local-hash-v1` is implemented.
- OCR is not configured. Pages from scanned PDFs are reported as unreadable, and the document becomes
  `PARTIALLY_INDEXED` or `FAILED`.
- Auto-extracted claims are cue-word candidates (`AUTO_CANDIDATE`) and must be verified. Owner claims are the
  reliable path.
- No book content ships with MIA. The 20 catalog titles are a reading list. The owner must upload documents they are
  entitled to use.
- Research uses a single venue (Binance spot), with survivorship bias and historical data only. A SUPPORTED verdict is
  not a trading authorization and does not promote a strategy.
