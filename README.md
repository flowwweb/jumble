# Jumble

Same letters. Different minds. A shared daily English puzzle: use all fifteen
tiles in as few words as possible. New day at midnight UTC. Gameplay is free.

Public repository: https://github.com/flowwweb/jumble. Reserved Firebase site:
https://playjumble.web.app. **Reservation is not a deployed release.** See
`BUILD_STATUS.md` for the current implementation and release proof.

## Run locally

Use Node22, npm, Firebase CLI and Java21. The frontend is strict TypeScript,
native HTML/CSS and DOM controls. Official Firebase Admin/Functions and Stripe
SDKs implement the backend. There is no frontend framework or custom bundler.

```sh
npm ci
node scripts/puzzles-generate.mjs --days=730
npm run dev
```

Open http://127.0.0.1:5000. `dev` builds the frontend, generates the function
manifest with Firebase's SDK, writes fake emulator-only secrets if absent, and
starts Hosting, Functions and Firestore under `demo-jumble`. No production data
is used. Local Checkout deliberately has no working payment key. The manifest
file route avoids a Windows loopback discovery timeout observed on this host.

```sh
npm run check
npm test
npm run build
npm run test:http  # while the local emulators run
```

`check` runs strict TypeScript checking and backend entry syntax validation.
Tests cover the engine, dictionary policy, every generated puzzle, server
sessions/results and sponsor reconciliation. The HTTP test uses real local
Firebase emulators and rejects non-local destinations. It exercises cookies,
CSRF rejection, invalid partitions, result retries and webhook signature rejection.
Independent browser and deployed QA are separate release gates.

## Rules and dictionary

Each physical tile can be consumed once per attempt; duplicate letters have
distinct identities. Invalid words retain the selection and consume nothing.
Reset returns the whole attempt. Words are 1–15 letters; A and I are the only
single-letter entries. Dead ends require a new attempt. The server revalidates
the full exact multiset and active dictionary version before saving any result.

The accepted dictionary is pinned ESDB revision
`1e5b7d3a72f47a71da5d28686c1dd4b397178485`, conservative size60 English,
with 80,764 accepted spellings after reviewed policy overrides. Complete upstream
notices are retained and distributed with the public word list. Proper names,
abbreviations, word parts and specified source categories are filtered; ordinary
lowercase homographs remain words. See `data/dictionary/README.md` and
`manifest.json` for exact commands, limitations, hashes and licenses.

`data/dictionary/overrides.json` is executable curation: additions require source,
reason and reviewer metadata; exclusions win. Metadata is not a substitute for
checking a real lexical source. No AI-generated word is accepted on its own.

## Puzzle runway

The initial schedule contains730 unique boards from2026-09-19 through2028-09-17,
split evenly between verified two-word and three-word minima. Generation uses
a smaller familiar vocabulary, but the optimum certificate checks the **entire
accepted dictionary**. The general solver independently cross-checks selected
dates. Two-word alternative counts are measured; three-word counts are not.

```sh
node scripts/puzzles-generate.mjs --days=730 --check
node scripts/puzzles-generate.mjs --days=1095
```

Extension preserves the published prefix. Never use `--replace-unreleased` for
a published schedule. Future dictionary changes need a reviewed versioned
transition. The complete private schedule and witnesses are generated into
`data/puzzles.json`, excluded from Git and public Hosting. The reproducible
generator is public and is not an anti-cheating secret. The API returns only
today or earlier published boards, never future boards or witness solutions.

## State and honest results

The browser stores recoverable progress and local streaks. Rankings, minimum,
time and session authority are never trusted from a restored local result.
Completed saves are revalidated against the server. Clearing browser storage
or switching devices loses local progress; there is no signup or cross-device
account claim.

An HttpOnly signed `__session` cookie identifies an anonymous installation.
Firestore transactions preserve one timer and one immutable result per day and
installation; resetting cannot restart that timer. Rank compares word count only.
Elapsed time is server-observed wall time, not an anti-cheat measure. Rank and
tie counts are explicitly submission-time snapshots of submitted results, not
invented players or claimed population percentiles. Anonymous identities can be
reset and do not prove unique humans.

Firestore client access is denied. Server HTTP validates JSON size, same-origin
POSTs and bounded request rates. Rate records have an `expiresAt` timestamp;
enable Firestore TTL on `rateLimits.expiresAt` during infrastructure setup.

## Analytics

First-party aggregate event counts live in Firestore `analytics/{UTC-day}`.
Events: puzzle_view, game_start, word_valid, word_invalid, puzzle_reset,
puzzle_complete, share, theme_toggle, sponsor_open, checkout_start.
Game start/completion are server-recorded and deduplicated per anonymous
installation/day. Other events count actions, not distinct people. No fabricated
baseline or third-party analytics identifier is shipped. The private collections
can be inspected through the Firebase console. No public analytics dashboard is
claimed.

## Sponsorship

Jumble adapts Whack-A-Reset's actual sponsor economics and payment reconciliation:
$1 minimum; whole USD; $10,000 cap; takeover computes the extra contribution
needed to exceed the current leader by$1 while crediting the same URL's balance.
Rank may move before payment confirmation. There are no seeded contributions.

Stripe-hosted one-time Checkout uses server amounts and stable submission IDs.
Session and PaymentIntent metadata bind `project=jumble`. A return URL never
credits funds. Only a signature-verified webhook with a freshly retrieved,
matching paid/captured USD charge can publish net credit. Charge identity makes
replays idempotent; refunds and lost disputes reduce credit without stale-event
resurrection. Hidden listings remain hidden. Test/live collections are separate.
See `docs/research/sponsor-economics.md` for the source mapping.

Subscribe the Jumble endpoint `/api/webhook` to `charge.succeeded`,
`charge.refunded`, `charge.updated` and `charge.dispute.closed`. No actual
purchase is part of automated release verification.

## Firebase release

Project `jumble-flowwweb`, Hosting site `playjumble`, region `us-central1`.
`api` is the gameplay/analytics function; `payments` is isolated so gameplay
does not require Stripe secret access. Each is capped at three instances.

Required Secret Manager names:

- `JUMBLE_COOKIE_SECRET`: securely generated random signing secret.
- `STRIPE_SECRET_KEY`: authorized live or test key, never a browser key.
- `STRIPE_WEBHOOK_SECRET`: signing secret for Jumble's own endpoint.

Keep `.secret.local`, `.env*`, credentials and debug logs out of Git/uploads.
Production secrets belong in Secret Manager. Blaze billing and a native default
Firestore database are prerequisites for the deployed backend. Provider actions
require their recorded authorization; do not substitute another project's data.

After independent candidate QA and provider setup:

```sh
npm ci
npm run check
npm test
npm run build
npm run functions:manifest
firebase deploy --only firestore:rules,functions,hosting --project jumble-flowwweb
```

The deploy must include the locally generated private schedule. Keep exact
source/lockfile/dictionary/schedule hashes with each release. Verify the actual
public game, refresh, sharing, empty/genuine ranks, analytics and Stripe Checkout
after deployment. Hosting release history supports rollback; backend changes
require redeploying the corresponding reviewed source and secret bindings.

Dependency audit at initial install reported moderate transitive gaxios/uuid
advisories in Firebase Admin's Storage dependency. The installed gaxios calls
uuid v4; the advisory targets v3/v5/v6 buffer variants, which this app does not
call. No Storage client is used. This is a scoped reachability assessment, not a
claim that the dependency tree has no advisories.
