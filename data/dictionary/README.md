# Pinned Jumble dictionary and puzzle custody

ESDB source: https://github.com/en-wl/wordlist

Revision: `1e5b7d3a72f47a71da5d28686c1dd4b397178485`. The complete upstream
`Copyright` is retained here and embedded in the distributed public word JSON.
Do not relabel this data public domain or omit its attribution on redistribution.

`manifest.json` records exact upstream commands, policy, source tree, word counts,
SHA-256 hashes, and public filename. `words.json` is the sorted accepted word
array shared by server validation. The versioned public JSON contains
`{ version, copyright, words }`. `generation.json` is the smaller size35 vocabulary,
not the authority for word acceptance. No definitions or corpus text are copied.

The export uses size60, American and both British spelling systems, variant
level1, US/GB regions, and no special categories. It excludes abbreviation and
word-part POS, named proper-name classes, and `coca-llm` tagged contributions.
Upstream warns that proper-name metadata is incomplete, so only source lowercase
ASCII entries are retained, with the ordinary pronoun `I` allowed. No accents
are stripped into new words. Ordinary `a` and `i` are verified upstream entries.
The upstream spellchecker also admits alphabet symbols; the reviewed `j2`
overrides exclude the other 24 single letters. Legitimate lowercase homographs
remain accepted: for example, source `John <n/person>` is excluded while the
separate lowercase `john <n>` remains. Name spellings are not globally banned.

`overrides.json` is the executable curation record. Additions require a spelling,
source URL, reason and identified approving reviewer; exclusions require a reason.
Normalization precedes application and exclusions always win. Metadata alone is
not proof of English validity: a reviewer must independently check the cited
source before adding an entry. No additions are made in this release. The importer
refuses a result containing single letters other than `a` and `i`.

Reproduction requires Git and Python 3.7+ with SQLite 3.33+; the verified host
used Python 3.13. Clone the source and check out the exact revision above, then:

```text
node scripts/puzzles-import-dictionary.mjs <source-directory> --build
node scripts/puzzles-generate.mjs --days=730
node scripts/puzzles-generate.mjs --days=730 --check
node --test tests/engine.test.mjs tests/engine-puzzles.test.mjs
```

The importer refuses another revision or tracked source edits. It invokes the
upstream `combine.py create-db` and `python -m libscowl word-list` tools, then
normalizes and sorts their output. It adds no guessed words. The importer may
show upstream skipped-match warnings during database construction; a failed
command aborts rather than silently accepting a partial export.

Keep generated JSON bytes in LF form to preserve their manifest hashes.

The generator starts on 2026-09-19 with a fixed seed. It uses everyday editorial
candidates only when present in the pinned size35 export, distinct tile multisets,
4-8 vowels, at most four copies of one letter, and at least 14 days between uses
of a witness word. Familiar witnesses alternate two and three words. Familiarity
is not independent human acceptance; it remains available for Product/QA review.

The exact certificate first validates the witness against all accepted words.
A witness of at most three words establishes an upper bound. It then checks
every accepted dictionary signature for a one-word solution and every possible
two-word complement. Absence of both proves a three-word minimum; absence of a
one-word solution proves a found two-word minimum. There is no time cutoff or
heuristic early success. Two-word alternative counts include distinct spellings,
not reordered copies of one word combination. Three-word alternative counts are
unmeasured. Tests cross-check selected dates with the general exhaustive engine.

`../puzzles.json` contains future boards and familiar witness solutions for the
server. Never copy it into public Hosting assets or return future boards/solutions
from the API. A public repository also exposes any committed schedule; release
ownership must decide its source-control custody. The deterministic generator
itself is reproducible and is not an anti-cheating secret.

To extend the frozen schedule, run `--days=` with a larger count. The generator
refuses shortening or modifying its existing prefix. Pin old dictionary versions
for historical results. A new dictionary/curation policy needs a separately
reviewed future schedule transition; do not overwrite a published day's rules.
The explicit `--replace-unreleased` flag is reserved for owner-authorized initial
curation before any schedule is published or frozen, never for a live correction.

`puzzle-manifest.json` gives the actual UTC end date, minimum distribution, seed,
source hashes and schedule digest. A finite schedule is not an indefinite runway.
It includes every witness spelling and the source-based offensive/vulgar tag
exclusions for direct Product review. Tests prove every witness belongs to that
filtered upstream subset. This does not claim that upstream tags are exhaustive
or that an independent human has accepted every puzzle.
