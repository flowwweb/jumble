# Easier daily SWAP puzzles

Product contract, 2026-09-23. Docs only. Local HEAD `ff2876a075b8de0bc8ee81371d5e8f480016d492`; normal corpus SHA256 `108956edffb01810c18628cc598a04dab424c0a858926c98eed6367212a79966`. No boards, dictionaries, schedules, results or providers changed. The target below is a proposed tuning band, not a human-tested difficulty claim.

## What the current source establishes

- `scripts/generate-swap-puzzles.mjs:7-35` picks three distinct familiar seeds, scrambles adjacent tiles, rejects initial valid rows and one-swap wins, and verifies the reverse witness. Its helper defaults to 12 scramble moves, but `scripts/generate-swap-adjacent-puzzles.mjs` actually passes 6 and admits globally proven minima of at least 4. Scramble length is not minimum distance or human difficulty.
- `engine/swap-solver.mjs:13-31` enumerates every admitted distinct-word triple and row order; the following solver proves minimum distance to any goal. Its `goalCount` counts ordered endpoints, not natural word sets and not distinct move paths. Divide by six for unordered triples under the current three-distinct-words rule. Do not apply that shortcut to blank days.
- Active data has 730 normal boards: minima 3:19, 4:221, 5:159, 6:331; median 5. The stored corpus therefore differs from the original generator's admission threshold. Dictionary reproof and retained-board policies are also relevant (`engine/swap-reproof.mjs`, `scripts/finish-swap-adjacent-v2-reproof.mjs`); do not blindly rerun the historical generator.
- Accepted vocabulary has 7,039 words. `data/swap/accepted-v4.json` explicitly approves row validation, not generator seeds. `data/swap/familiar-v1.json` has 137 editorial seeds; `docs/research/swap-common-words-v2.json` has 1,478 editorial common words. These files contain membership lists, not measured usage frequencies or Zipf scores. ESDB size 70 is not a numeric familiarity score. Use editorial membership now; no new frequency dependency is needed.
- Of 730 stored optimal witnesses, 564 use three editorial-common words; 104 use two, 50 use one, and 12 use none. This does NOT prove those 166 boards lack a different equally short familiar optimum. A familiar starting seed triple does not guarantee the solver's selected optimum is familiar.

Fresh goal enumeration against the editorial common list, with stored global minimum/goal certificates for context (no answer spoilers):

| Normal corpus date | Global minimum | All admitted unordered triples | All-common unordered triples |
| --- | ---: | ---: | ---: |
| 2026-09-23 | 5 | 121 | 5 |
| 2026-09-25 | 5 | 92 | 2 |
| 2026-10-04 | 6 | 265 | 1 |

Counts alone do not establish easy access: hundreds of dictionary endpoints can hide a single familiar option, and familiar alternatives may be many swaps away. The Sep 24 normal entry is not the served candidate when the scheduled blank-day override applies.

## Target band for the next normal boards

Keep rules and the accepted dictionary unchanged. Tune candidate selection, not score accounting or validation.

| Metric | Admission / target |
| --- | --- |
| Exact global minimum M | Admit 3-5 adjacent swaps; target median 4 across the next 14 normal dates, with at least 10 of 14 at 3 or 4. No minimum-6 board in this first easier batch. |
| Natural solution diversity | At least 3 distinct unordered triples whose words all belong to the editorial-common list. Prefer 3-12; more than 12 is not an automatic failure. Row permutations and alternate swap orders do not count as new solutions. |
| Familiar shortest solution | At least one all-common triple reachable in exactly M swaps. Prefer that witness for the post-win best-solution display while preserving the true global minimum. |
| Accessible alternatives | At least 3 different all-common triples reachable within M+2 swaps, including the familiar optimum. Record the shortest proven distance for each; median of the three shortest familiar-triple distances at most M+1. Do not require the median distance to every distant endpoint. |
| Not immediately obvious | Zero admitted complete rows initially; no one-swap win; retain exact minimum >=3. Do not manufacture difficulty with obscure words or a longer scramble. |
| Perceived ambiguity | Report distinct common triples and common words participating in those triples, not every individually formable word. Read the three nearby answer sets for ordinary meanings; reject a purportedly common path that depends on specialist/archaic interpretation. |

These are initial product targets. Human time-to-solve, abandon rate and typical extra swaps remain unmeasured. Do not label the existing 58-entry victory sample as evidence for this band or derive a human median from solver distances.

Reuse the existing seed generator and exact solver. Start proposals from the existing 137 seeds with 4-6 scramble steps, then select by the metrics above; lowering scramble length alone is insufficient. Reuse the solver's exhaustive goal enumeration, classify endpoints by sorted word triple and editorial membership, and perform a bounded shortest-distance search until three familiar triples meet the distance conditions. Stop expansion at won states, matching gameplay's terminal lock: a path that first solves an earlier board cannot continue to claim a later endpoint. Keep full-vocabulary global proof separate from familiar-goal filtering. Budget exhaustion means UNVERIFIED, never a zero count or admission. No requirement to count every possible move sequence.

Build's smallest slice is a private candidate shortlist plus machine-readable per-board receipts for the next 14 eligible normal dates, using existing offline helpers. Each receipt binds board/rules/dictionary, M, unordered counts, the three nearby familiar sets and legal paths, initial-row/one-swap checks and proof status. Keep answers and paths in private corpus custody; user-facing review shows counts and spoiler-free examples only. Do not regenerate all 730 days or narrow the accepted vocabulary to make the metrics look better.

## Today's board and daily identity

Clock checked at **2026-09-23 14:51:10 UTC**. Today is Sep 23 UTC. **Do not replace today's board under its existing date.** `functions/game.mjs:64-78` resolves by date and stores sessions/results/stats under mode plus date, without a board revision in their paths. `src/app.ts` also binds restored saves to the original board and links challenges by day/mode. A replacement can invalidate saved moves while retaining incompatible best scores and shared links. Even zero completed results would not prove nobody has fetched or started it.

Preserve every active/past board, its answers, rule version and dictionary bindings. Emergency same-day replacement would require explicit versioned daily identity across serving, sessions, saves, results, rank, history and links, retaining the old identity. That migration is outside this tuning task; no silent answer overwrite or result deletion.

`functions/index.mjs:27-31` routes scheduled blank dates separately; local `data/swap-blank/puzzles.json` schedules Sep 24 with minimum 3. Preserve this approved blank candidate and its displaced normal record. The earliest normal tuning date is therefore **Sep 25 UTC**, subject to a fresh clock and exact release inspection. This is a candidate date, not authorization to alter live state or proof that no preview/release has exposed it.

Before assigning future candidates, Build verifies they remain future, have not been served/played through another route, and are not reserved blank dates. Archive the previous future corpus/manifest by content hash before replacing selected date entries. Freeze and reprove the new subset under the unchanged accepted dictionary, update hashes and preserve all unselected entries byte-for-byte where practical. Validate the selected date plus neighboring normal/blank routing, save/restore, best-score replay and answer display. Recheck the UTC cutoff immediately before deployment; skip any date that has become active. No recurring cadence or automatic rescheduling is implied.

## Evidence limits and handoff

### First four candidates: Product review

Reviewed private snapshot `.cache/difficulty-20260923/review-first4.json`, SHA256 `15b1a9b7d6688ac2e701c4b360a8433a79c9e35857735eabf851d6eda5158979`. All twelve nearby word sets pass editorial familiarity review: ordinary contemporary meanings, no required specialist or archaic reading. Answer words and starting boards intentionally omitted here.

| Candidate | Minimum receipt | Nearby distances | Editorial decision |
| --- | ---: | --- | --- |
| candidate-1 | 3 | 3, 4, 5 | Accept for shortlist |
| candidate-2 | 4 | 4, 5, 6 | Accept for shortlist; third route has a less everyday but ordinary clothing term |
| candidate-3 | 4 | 4, 4, 6 | Accept for shortlist; two distinct familiar optima |
| candidate-4 | 5 | 5, 6, 7 | Accept for shortlist; use sparingly within the batch's minimum-5 allowance |

Independent local assertions passed: four board hashes match receipts; no admitted initial rows; three distinct unordered nearby sets per candidate; editorial membership for every word; all twelve terminal-locked paths solve with the reported move counts; minimum/median/maximum distance inequalities meet the contract. This validates legal witnesses and receipt consistency, not an independent shortest-distance reproof. Four-candidate median is 4, with three at 3/4. The complete 14-candidate batch target, QA proof and scheduling remain open; no dates are assigned by this acceptance.

Read-only Node checks recomputed corpus summary, editorial membership counts and common-goal enumeration for Sep 23-Oct 6. No full-corpus optimality reproof or human/browser difficulty test ran. Stored global minima are certificate data, not a fresh independent search in this review. No live requests, provider inspection or telemetry was used. Build owns candidate generation and implementation; QA owns fresh solver/replay/date-bound runtime checks; Product reviews familiarity and the shortlist.
