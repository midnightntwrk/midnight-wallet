# Versioning the formats we persist, and proving old data still loads

- Status: accepted
- Date: 2026-09-16

## Context and Problem Statement

The SDK hands an application five strings to store and give back later: the shielded, unshielded and dust wallet
snapshots, the transaction history, and the pending transactions. Every one of them is a persisted format we do not
control the lifetime of — an application may hand back a string written a year ago by a version we no longer ship.

Until now only one of the five carried any version marker, and nothing anywhere pinned what a released build actually
wrote. A field could be added, renamed or made required and every test would stay green, because every test
round-tripped through the build that was running. The formats were only compatible by accident.

Two breaks had already happened, both found by reading the code rather than by a failing test:

- Making `lifecycle` and `identifiers` required on a transaction-history entry meant every non-empty history written by
  the then-current npm `latest` threw a `ParseError` on restore. Not yet in a stable release, but on the `beta` tag and
  due to ship.
- The shielded snapshot used to embed the transaction history as `txHistory`. When that field was dropped from the
  schema, Effect Schema's default of ignoring unknown keys meant those snapshots restored **without error** and the
  history was silently discarded on the next write.

How do we state what we promise about persisted data, and make a breach of it impossible to merge by accident?

## Decision Drivers

- Losing a user's data must be impossible to do quietly. A loud failure is recoverable; a silent one is not.
- The rule has to hold for all five surfaces, not the one somebody remembered.
- A gate nobody can forget to run beats a convention nobody can remember to follow.
- Whatever we add must not decay between releases: coverage that only grows when someone remembers will stop growing.
- The cost of adding a format version should be small enough that nobody is tempted to avoid one.

## Considered Options

- Leave the formats unversioned and rely on review to notice shape changes.
- Version each surface, and pin what published releases wrote with fixtures named after those releases.
- Version each surface, and pin each **format version** with fixtures, independent of releases.

## Decision Outcome

Chosen option: **version each surface and freeze fixtures per format version**.

### The rules

**Envelope.** Every persisted surface carries `{ version: 'vN', ... }`, a string literal, as pending transactions
already did. A payload with no `version` is the first version of its surface: the envelope did not exist when it was
written, so its absence is the marker. No payload has ever been written carrying the literal `v1`.

**Compatibility promise.** Every format version shipped in a stable release loads in every later stable release. No
downgrade: a reader that meets a version it does not know refuses the payload and says which version it found. A format
that only ever existed on a pre-release tag carries no promise.

**Upgrades are chained.** A step goes from `vN` to `vN+1` and never skips, so each step only has to know the version
immediately before it, and can be written once and then left alone. The word _migration_ is not used for this: the
runtime already uses it for moving live wallet state across a hard fork. These are **format upgrades**.

**Bump rule.** A required field added, or a field removed, renamed or retyped → a new format version, one upgrade step,
one new fixture folder. An optional field added → no bump; re-record the drift baseline. The internals of a ledger blob
are the ledger's concern, not a format version of ours.

**Failure is loud.** A payload that cannot be read raises a tagged error carrying the surface, the version detected and
the cause. It is never swallowed into an empty store.

### How it is enforced

`packages/serialization-tests` is a private package holding payloads captured from published releases, filed by the
format version they are in:

```
fixtures/<surface>/<formatVersion>/<origin>.json    frozen, never edited
fixtures/_baseline/<surface>.json                   what this build writes, re-recorded on purpose
```

Four checks, all of which fire in the pull request that does the work:

| Check                   | Answers                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| Compatibility tests     | Does real stored data still load, with the right content?                    |
| Drift test              | Has what we _write_ changed since it was last recorded?                      |
| Format-version coverage | Is every version the code declares backed by a payload someone can point at? |
| Frozen-file check (CI)  | Has anyone edited the evidence instead of fixing the code?                   |

The compatibility tests assert content — balances, entries, lifecycles, sections — not merely that nothing threw. The
drift test compares against a recorded payload, because a value comparison is the only check that cannot be satisfied by
a plausible-looking near-miss.

### Why per format version rather than per release

A fixture pins a _shape_. Shapes change rarely; releases happen constantly, so a fixture per release is mostly
duplicates, and it makes the gate depend on the release process — which would mean a fixture is owed at a moment when
nobody is looking at this code, in a pull request generated by a bot and rewritten on every push.

Filing by format version puts the obligation where the work is. A new version is a code change, so the check fires on
the branch that makes it, for the person making it, who can simply add the fixture. Nothing is owed at release time, so
nothing can be forgotten at release time.

### Positive Consequences

- Both known breaks are fixed, and neither can recur silently.
- All five surfaces are versioned, so the _next_ change to any of them is a one-step upgrade rather than an
  investigation.
- The gate cannot erode: coverage is owed when a version is created, and CI will not let the branch merge without it.
- Unshielded gained its first unit tests; its snapshot previously had no test of any kind.

### Negative Consequences

- Five more frozen folders to carry, and a baseline that must be re-recorded whenever output legitimately changes.
- A fixture can only ever be captured while its version is still current. A version superseded before anyone captured it
  cannot be evidenced afterwards — hence the coverage check, which makes that impossible to reach by accident.
- The corpus only covers releases up to the point this landed. Older payloads were captured by installing published
  packages from npm; that generator is not part of the repository, and recovering an uncaptured old format would mean
  resurrecting it.

## Pros and Cons of the Options

### Leave the formats unversioned

- Good, because nothing to build.
- Bad, because it is the status quo that produced both breaks.
- Bad, because a reviewer cannot see that a schema edit is a data-loss bug; it looks like an ordinary field change.

### Fixtures named after releases

- Good, because "what did 4.1.0 write" is directly answerable.
- Bad, because a fixture becomes owed when a release happens, which is a moment nobody is watching this code.
- Bad, because the obligation lands in the changesets release pull request, which is regenerated on every push to main,
  so anything added there by hand is lost.
- Bad, because most releases change no format, so most folders prove nothing.

### Fixtures named after format versions

- Good, because the obligation lands in the same pull request as the change that creates it.
- Good, because it is independent of the release process entirely.
- Good, because the number of fixtures tracks the number of format changes rather than the number of releases.
- Bad, because the release a payload came from is now metadata inside the file rather than the folder name.

## Links

- Rules: [.claude/rules/persisted-formats.md](../../.claude/rules/persisted-formats.md)
- Glossary: [docs/Design.md](../Design.md)
- Package: `packages/serialization-tests`
