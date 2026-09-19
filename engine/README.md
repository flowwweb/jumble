# Shared partition rules

Pure JavaScript ESM, with no dependencies, storage, network, random source, or
ambient clock. Share this module between browser and authoritative server.

The reversible rule contract is `partition-v1`: exactly 15 ASCII letter tiles,
words of 1 to 15 letters admitted by the injected dictionary, each tile consumed
once, all tiles required, fewer words better. Reset clears confirmed words and
used indices in the caller. Dictionary membership alone decides validity.

Create a dictionary once using `createDictionary(arrayOrSet)`. Entries must be
curated to 1 to 15 ASCII letters; uppercase is normalized. Reuse its immutable
surface across calls. There are no implicit one-letter words or other additions.

- `validateSelection({ tiles, selectedIndices, usedIndices }, dictionary)` checks
  ordered tile indices without input mutation. A valid result returns `word` and
  copied `indices`. Previously confirmed tiles cannot be reused.
- `validatePartition(tiles, words, dictionary)` verifies a complete solution and
  derives `wordCount`. Invalid user payloads return `{ valid: false, code }`, with
  `wordIndex` when one submitted word failed.
- `solveOptimalPartition(tiles, dictionary)` returns `{ words, wordCount }` or
  `null` when no full partition exists. Exhaustive memoization of letter-count
  states produces a deterministic representative optimum, not an enumeration of
  all alternative solutions. Invalid board configuration throws.
- `utcPuzzleId(dateOrEpochMs)` derives `YYYY-MM-DD` from an injected UTC instant.

The server owns puzzle/dictionary version binding, received timestamps, player
identity, idempotency, finality, ranks, and persisted results. Client success or
a claimed optimum is not authority. Run the offline solver before publication;
prefer verified 2 to 3 word optima in generation, not by restricting legal play.

Proof: `node --test tests/engine.test.mjs`. These tests establish local rules only,
not browser, accessibility, persistence, payment, deployment, or release acceptance.
