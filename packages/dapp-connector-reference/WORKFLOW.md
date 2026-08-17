# DApp Connector Reference — Development Workflow (canonical)

The multi-agent workflow + engineering mandates for the reference DApp Connector implementation and its conformance
suite. `PLAN.md` tracks the phases + current step and references this file.

Adapted from the `spike-compact-capsules` island workflow. The island model split work into sealed `tests/builder/` and
`tests/tester/` suites; **here there are no islands** and **the builder's and tester's suites are, mostly, the one
conformance suite** in `src/test/suites/` — the spec-derived, pluggable suite that is itself a primary deliverable. The
dual sealed-directory structure and all island / Racket / Kachina references are therefore dropped; what survives is the
role discipline and the seal _against implementation internals_ (see **Conformance suite & seal** below), which is
exactly what keeps the suite pluggable by other wallets.

The specs this work is driven from (never re-derived from code):

- **DApp Connector API** — `midnightntwrk/midnight-dapp-connector-api/SPECIFICATION.md` (+ `src/api.ts` types). This is
  the contract the conformance suite encodes.
- **Wallet Engine** — `midnightntwrk/midnight-architecture/components/WalletEngine/Specification.md` (tx/coin lifecycle,
  balance types) + its `test-vectors/`.
- **Ledger** — `midnightntwrk/midnight-ledger/spec/` (`intents-transactions.md`, `zswap.md`, `dust.md`, `night.md`).

## Agents

- **orchestrator** — drives the process, coordinates agents, maintains `PLAN.md`.
- **researcher** — grounds design decisions + Midnight specifics; runs during definition (feeding the architect) and on
  demand whenever any agent needs grounding; raises inconclusive findings to the human.
- **architect** — owns architecture and every architectural decision _for the reference impl_ (the API spec itself is
  external and authoritative — the architect conforms to it, does not rewrite it). Other agents bring doubts to the
  architect; the architect brings open architectural questions to the human.
- **builder** — implements the reference `ConnectedAPI` + supporting code and extends the conformance suite (see
  **Builder TDD mandate**).
- **tester** — challenges the build against the spec: derives cases from the spec/architecture, runs the conformance
  suite against the implementation, and probes gaps the suite does not yet cover.
- **reviewer/auditor** — independently reviews + challenges the architecture, the code, and the conformance suite.

## Flow

1. **Definition (interactive).** Researcher grounds; architect settles the architecture (how the reference impl maps the
   external API spec onto the Wallet Facade) with the human in the loop; human approves the definition gate. The API
   spec is the authoritative contract — the architect produces architecture + the conformance-suite shape only.
2. **Build (background).** Spec-first: the conformance suite encodes the spec requirement before the implementation
   satisfies it (red → green), driven only from the spec + architecture and the public API surface.
3. **Review (background, parallel).** Three independent sub-steps: architect spec-conformance review · tester runs the
   conformance suite against the code + probes uncovered gaps · reviewer/auditor challenges architecture + code + suite.

Only Definition is interactive; Build and Review run in the background. **Every agent runs to completion** — no agent
blocks mid-run waiting on the human. Escalation is therefore **batched at phase gates**: agents record open questions in
their output, the orchestrator gathers them and surfaces them to the human at the gate, the human answers in a single
pass, and the round continues. When any reviewer is unhappy: capture findings in a document, orchestrator updates
`PLAN.md`, cycle returns to definition. **Round cap = 3**; if review has not converged, escalate to the human rather
than looping. When a full-stack path is un-drivable, root-cause with a debugger before escalating. **The work is
complete once all three review sub-steps pass** (architect spec-conformance · conformance suite green against the code ·
reviewer/auditor challenge).

## Variation — Research-first (design-heavy questions)

Some questions are gated on an unsettled **design**, not on build effort — the hard, contested deliverable is the model
itself, which must be adversarially vetted before any code is written. For these, run a **Research phase** _before_ the
standard Definition→Build→Review:

- **Architect is the worker.** The architect produces the design (the model + architecture notes) as the primary
  artifact — there is **no builder** in this phase.
- **Two research roles feed the architect:**
  - **researcher** — grounds each design question in Midnight/Wallet-SDK specifics + feasibility ("is X possible
    _here_").
  - **explorer** — scouts external / cross-domain prior art for **ideas to borrow** ("how do other wallet connectors /
    dApp-connector standards solve this"), returning candidate patterns with their transfer + caveats.
- **Adversarial vetting.** The security-auditor + reviewer/auditor attack each candidate; the **human decides at every
  fork** — research forks are _interactive_, not batched at a gate.
- **Iterate to convergence, human-gated.** Rounds repeat (explore / ground → architect → adversarial vet → human) until
  the human approves the **design gate**. **No round cap** here — a contested design may take several rounds; the exit
  is human approval, not a count.
- **Then the main workflow executes.** Only after the design gate passes does the standard Definition→Build→Review run
  (spec-first) to implement the vetted design.

Artifacts: findings under `review/` (grounding + exploration); the converging design in architecture notes; `PLAN.md`
tracks research rounds + open forks.

## Engineering mandates (durable)

### Builder TDD mandate

- **Red → green → refactor.** For each requirement: write a failing test with clear assertions, verify it fails for the
  expected reason, implement the minimum to pass, refactor while green.
- **The conformance suite is the primary evidence the reference impl meets the spec.** It MUST be extensive enough to
  stand on its own — it does not lean on ad-hoc checks to establish correctness.
- **Spec drives the suite.** Every requirement in the DApp Connector API spec has a corresponding case in
  `src/test/suites/`. When the spec changes, the suite changes first.
- **Never delete tests to go green.** If a case fails against new code, update it to the new code (or mark it `it.skip`
  with a root-caused pointer to the upstream gap) — do not remove it. Deleting tests hides regressions and shrinks the
  conformance contract.

### Conformance suite & seal (replaces island builder/tester split)

- The suite in `src/test/suites/` is **the shared builder + tester deliverable**. It must remain **pluggable by any DApp
  Connector implementation**, so it is **sealed against implementation internals**: suites exercise only the public
  `ConnectedAPI` surface + the `DappConnectorTestContext` contract, never private fields or the reference impl's module
  internals. This seal is what lets an external wallet run the same suite unchanged.
- **Tester independence is preserved by discipline, not by directory.** The tester probes the spec for requirements the
  suite does not yet encode and adds adversarial cases (including **invariant-violation** cases expected to fail —
  `@ts-expect-error` for compile-time, `expect().toThrow` / `test.fails` for runtime — so that "green" proves the
  invariant rejects the violation). The tester does not read reference-impl internals beyond exported signatures.
- **Capability flags are banned.** Per-implementation gaps are expressed as `it.skip` markers with a root-caused
  comment + file:line pointer to the upstream fix (sized to paste into a bug ticket), so the suite stays honest about
  what is not verified end-to-end without silently weakening the contract.
- **Domain boundary invariants** (e.g. private state / keys never leaving the wallet, balances reported are _available_
  balances) are non-negotiable and re-verified by the suite.

### Operational discipline

- **Background jobs:** kill stray simulator/indexer/prover processes before writing findings/scores; clear the ports
  you'll use before starting; `try/finally` teardown in `afterAll`; never leave processes running.
- **Code quality:** follow the repo `CLAUDE.md` + ChiefArchitect code-quality guide — no `any` outside documented WASM
  boundaries, no silent error swallowing, preserve error cause chains, no fallback chains, no precarious hacks, no
  `eslint-disable` to pass lint, casts only with justification comments.
- **Communication:** every agent invokes the **`caveman` skill** and writes all internal reports, findings, and round
  docs in that mode — terse; technical substance, code, error strings, identifiers exact; auto-clarity exception for
  security warnings, irreversible-action confirmations, and multi-step sequences where terseness risks misread. This
  applies to **agent-internal artifacts only** — shipped artifacts (README, `CONFORMANCE.md`, JSDoc, PR body,
  changesets) are written in normal prose. Reference the skill; do not restate its rules.

## Artifacts

Human kickoff + deltas (in `PLAN.md` / chat) → architect: architecture notes → conformance suite: `src/test/suites/` (+
`src/test/context.ts`, `simulatorTestUtils.ts`) → builder: `src/` reference impl → review:
`review/round-M/{findings,scores}.md`. Orchestrator maintains `PLAN.md`.
