# MIA 5.0 recovery register

The recovery branch is based on `claude/mia-unified-01` at `541915070cb2b9b2df6df70be7ac2d18327d1ba9`. The source package is `MIA_5_0_Unified_Engineering_Pack.zip` with SHA-256 `a7d870e9bf25aa7b99191bc1ccc17fe33a6c4a6e738b89acf6791cef0e3fe0fd`. All 17 entries were inventoried and the listed entry checksums matched. The package's metadata validator and six standalone contract tests passed. These checks establish catalog consistency. Runtime checks use MIA's existing test suites.

| Recovery ID | Disposition | Evidence |
| --- | --- | --- |
| MIA-RCV-P0-001 | Fixed in the recovery candidate | `guardian.test.ts` forces a SQLite write failure after the pause update and checks rollback of the pause, audit and handled marker. A retry publishes only after commit. The existing import boundary test still enforces pause-only authority. |
| MIA-RCV-P0-002 | Fixed in the recovery candidate | `ops-lease-hardening.test.ts` forces an integrity exception on expired-lease reacquisition by a cached leader. The engine stops and refuses writes until restart and a new check, including when lease cleanup fails. |
| MIA-RCV-P0-003 | Open | Complete the encrypted-restore dependency MIA-RCV-P2-002 in isolated storage, then bind snapshot verification to one file identity. Review the existing backup changes in #53 before modifying the same module. |
| MIA-RCV-P0-004 | Fixed in the recovery candidate | `depth-stream.test.ts` covers old snapshots, gaps during replay, crossed depth, socket replacement, and the existing half-open watchdog. `depth-stream-fabric.test.ts` verifies REST polling stays eligible after insufficient snapshots. The existing age and liquidity checks still govern paper fills. |
| MIA-RCV-P1-002 | Fixed in the recovery candidate | `guardian.test.ts` verifies that an already handled newest incident cannot starve an older incident. Audit markers preserve idempotency when the settings cache is full. |
| MIA-RCV-P1-003 | Fixed in the recovery candidate | `guardian.test.ts` proves that a P0 appended after 20,000 matching audit entries is considered. The scan keeps the newest matching rows and sorts them chronologically for burst detection. |

The remaining recovery tasks retain their source-catalog status. This candidate does not meet the full release criteria while backup recovery and the remaining P1 tasks are open.

## Integration and rollback

- The recovery diff targets [unified PR #45](https://github.com/Naokiri5/naokiri/pull/45). The heads of #14 and #15 already occur in its history.
- [Backend PR #53](https://github.com/Naokiri5/naokiri/pull/53) and [Privy PR #54](https://github.com/Naokiri5/naokiri/pull/54) carry distinct changes and remain separate review inputs. Validate the final combined tree before owner approval.
- [Q100 PR #59](https://github.com/Naokiri5/naokiri/pull/59), the B-MIND work and NEXUS retain their existing owners and catalogs. The optional Q100 check against the unified checkout reports the catalog is absent.
- Roll back by reverting the affected recovery commits. No migration or data rewrite is required. An already committed Guardian pause still requires the normal owner action to resume.
