# M5-C — Promise, gas and storage results

Base revision `fdd8b48acaa1ad60417ad628b08a7783ede9aba6`; initially clean `main...origin/main`.
Implementation/validation: 2026-11-16, Africa/Douala. Local changes are uncommitted.

**Actual local receipts executed under nearcore2.14.0/protocol88.**
Configured gas is distinct from observed burn. These measurements use the local
SDK-standard token fixture, not production Tidepool execution or a live gas quote.

| Stage | Configured allocation | Canonical measured receipt burn (Tgas) |
| --- | ---: | ---: |
| Entry minimum | 220 Tgas | 5.186991445 |
| Storage query | 10 Tgas | 1.214253975 |
| Storage callback including descendants | 170 Tgas | 5.332291180 |
| ft_transfer | 30 Tgas | 1.715502528 |
| Final settlement callback | 50 Tgas | 4.325938854 |

Entry creates10+170=180 Tgas children. At the220 minimum it has40 Tgas for
entry execution/scheduling overhead; an additional remaining-gas guard preserves
10 Tgas margin before the child allocations. Storage callback170 includes the
30+50=80 Tgas descendants, leaving90 Tgas for its own work; it also checks a
10 Tgas scheduling margin. **Do not sum nested allocations as sibling budgets.**
No unused-gas weights silently enlarge token/callback caps. All monetary deposits
are explicit: zero for storage/callbacks,1 yoctoNEAR for ft_transfer.

The current local runtime reports maximum total prepaid gas **1000 Tgas**;
this was queried rather than assuming the historically common300 limit.220 fits
that observed limit. Main requests normally use300; a real220-Tgas call succeeded,
and100 Tgas was rejected before approval consumption. Any live deployment still
requires fresh target-network protocol/gas checks.

Canonical unique transaction+receipt burn: **19.203146462 Tgas**,
including refund/action overhead. Minimum-entry success: **19.256679371 Tgas**.
Per-stage burn is not total prepaid gas and does not include descendant burn twice.
The signer prepays transaction/promise gas and receives unused-gas refunds; the
contract supplies storage backing and the outgoing1 yocto. Campaign USDC does not
pay NEAR gas. No balance/deposit amount for a live transaction is proposed.

## Failure measurements

| Scenario | Total unique burn (Tgas) | Final native state | Interpretation |
| --- | ---: | --- | --- |
| schedule-panic | 11.757566642 | PreflightPending | Separate fault artifact |
| panic-callback | 18.917200262 | TransferPending | Separate fault artifact |
| oog-callback | 15.806043619 | TransferPending | Separate fault artifact |
| upgrade-between-transfer-and-callback | 19.619128808 | TransferPending | Separate fault artifact |
| delivered-but-unexpected-result | 19.181791190 | ManualReview | Production candidate plus explicitly documented token fixture control |
| insufficient-token-balance | 18.892634120 | AttemptFailed | Production candidate plus explicitly documented token fixture control |

The OOG artifact attaches1 gas to the final callback and produces the actual error
`Exceeded the prepaid gas.` after delivery. Receipt `gas_burnt` also includes action/
loading costs; it must not be equated with that1-gas function budget. This injection
proves failed-callback lock safety, not that a legitimate50-Tgas callback normally
runs out of gas. There is no fault switch or caller-supplied callback gas in production.

## Storage and NEAR

The local storage price is10^19 yoctoNEAR/byte (0.00001 NEAR/byte).
Execution after an already reserved/approved payout grew actual account storage by
**340 bytes** for the canonical case and **343 bytes** for larger test IDs/auth
strings:0.00340–0.00343 NEAR backing at that price. Reservation and approval state
were allocated earlier and are not included in that execution-only delta.
Evidence is preallocated before the first promise; completion changes fixed-size
fields and existing records. A16,384-byte headroom check plus1 yocto is required
before entry and before transfer scheduling:0.16384 NEAR above current storage
backing at the observed price. This margin is not an outgoing fee or new USDC debit.

| Native prefix | Records sampled | Raw key+value size range (bytes) |
| --- | ---: | ---: |
| `native-attempt-records-v1` | 18 | 199–200 |
| `native-authorization-records-v1` | 18 | 440–447 |
| `native-execution-outcomes-v1` | 18 | 246–248 |
| `native-payout-mode-v1` | 18 | 30–30 |
| `native-payout-records-v1` | 18 | 404–411 |

These raw sizes exclude protocol record overhead and WASM. `storage_usage` snapshots
measure actual account storage. Incompatible-upgrade snapshots include a changed
code size, so their net byte delta is not a per-payout storage cost. The native
headroom test temporarily drains/restores **synthetic local NEAR**; low balance
rejects before consuming consent. No existing account's NEAR or USDC was moved.
Large u64 payout IDs and arithmetic boundaries are covered by unit tests.

## Limits and evidence

Measurements are observed local runs, not an exhaustive formal gas bound, a
multi-validator load test, or a guarantee about future token/protocol upgrades.
All execution inputs/state strings are bounded; callbacks preallocate fixed fields
and reload one payout/campaign. Other allowed storage writes or an arbitrary root
upgrade can still exhaust resources. A failed callback leaves the previous lock;
M5-D must reconcile rather than resend. Recheck deployed token code and target
protocol limits before any separately approved live gate.

[Per-action gas/storage data](evidence/milestone-5/m5c-implementation/gas-and-storage-measurements.json)
includes actual receipt IDs, method arguments/deposits/gas, outcomes, balance deltas
and storage snapshots. [Local protocol configuration](evidence/milestone-5/m5c-implementation/local-protocol-config.json)
records the observed limits. These RPC receipt IDs are off-chain evidence, not
fabricated contract callback fields.
