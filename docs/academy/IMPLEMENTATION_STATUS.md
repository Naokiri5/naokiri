# Academy — Implementation Status (deliverables 1–16)

The status words are:
- **DONE**: implemented and tested.
- **PARTIAL**: works, with the stated gap.
- **NOT STARTED**: not built yet.
- **OUT OF SCOPE**: deliberately not built.

| # | Deliverable | Status | Evidence / gap |
|---|---|---|---|
| 1 | Ingestion: PDF, EPUB, DOCX, HTML, MD, TXT | DONE | `extract.ts`; one test per format in `knowledge.test.ts` |
| 2 | Metadata, chapter/page references, deduplication, failure reporting | DONE | sha256 and text-hash duplicates; coded failures shown in the UI |
| 3 | Resumable processing and reprocessing | DONE | 40-page PDF batches; resume test proves the passages come out identical |
| 4 | Knowledge store: keyword, vector and hybrid search | PARTIAL | The vectors are lexical (`local-hash-v1`). The provider interface is ready for a semantic model. |
| 5 | Retrieval by chapter, author, topic, citation and concept | DONE | `search.ts` filters; `/citations/:id` |
| 6 | Concept interpretation cards | DONE | 19 curated cards; owners can add more (zod-validated) |
| 7 | 12-discipline taxonomy and 100-book catalog | PARTIAL | 12 disciplines and the 20 priority titles are seeded. The other 80 titles come in through `POST /catalog/import`. No book content is bundled. |
| 8 | MIA integration (decision reports, workers, Strategy Lab, risk, scanner, Joe) | DONE (evidence only) | `knowledge.refs` on decision reports; Joe's `search_knowledge` tool; domain concepts; zero authority |
| 9 | Research lab: walk-forward with purge/embargo, metrics, reproducibility | DONE | 3 experiment kinds, immutable records, integrity hash, live run on BTCUSDT verified |
| 10 | The 10 research projects | PARTIAL | Built: historical candle store, volatility-clustering study, return-autocorrelation (mean-reversion/momentum) study, performance-metrics engine, strategy-comparison lab, purged/embargoed walk-forward, 90-day paper-experiment tracker. The remaining projects in the directive are not built yet. Probability calibration stays in DITAS (`ditas/calibration.ts`) and is linked, not duplicated. |
| 11 | Conflict and quality handling with evidence classes | DONE | 6 classes; conflicts preserved side by side, with resolution steps |
| 12 | Memory architecture A–F | DONE | Mapped to the existing stores with freshness policies; no duplicate store |
| 13 | Provider-independent LLM and embedding interfaces | DONE | `providers.ts`; extractive fallback when no key is set |
| 14 | Academy UI | DONE | `/academy`, 8 tabs; Playwright upload→index→search flow |
| 15 | Security | DONE | Owner session and CSRF; magic-byte detection; zip-bomb, size and page limits; script stripping; DRM refusal; FTS injection-safe queries; LLM prompt fencing |
| 16 | Tests and docs | DONE | 31 unit/integration tests and 1 e2e flow; this folder |

Live verification (2026-11-17, Binance public klines, BTCUSDT 1h, 2,999 closed candles):
- volatility clustering: SUPPORTED (shuffle p ≈ 0.005)
- lag-1 autocorrelation: NOT_SUPPORTED
- trend_pullback walk-forward: INSUFFICIENT_EVIDENCE (21 out-of-sample trades, expectancy −0.26R, 95% CI crosses 0)
