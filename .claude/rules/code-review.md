# Code review — hard rules

Always loaded (no path filter): these govern how a review finding becomes a change, whichever files it touches.

## Turning a finding into a fix

- **Translate first.** Before writing anything, restate the finding as the invariant it protects ("a failed poll must
  not clear a proven `Behind`"), not as the reviewer's sentence. The invariant is what the test, the code and the
  comments express; the reviewer's wording never appears in the repo.
- **One finding, one TDD cycle** (`tdd` skill): design the test from the invariant, observe it fail for that reason,
  stop for the user's review, then implement. A finding with no failing test is not fixed — it is asserted.
- **Verify before agreeing.** Read the code the finding points at and confirm the claim holds; a review can be wrong or
  half-right. Report what was confirmed, what was refuted, and any gap the suggested fix leaves open — but do not widen
  the change to close that gap without the user's decision.
- **Never weaken a test to satisfy a finding**, and never trade one guard for another silently. If the fix cannot pass
  the test as written, present the gap to the user (`.claude/rules/testing.md` → TDD contract).

## Where the trail lives

- **Code and test comments state the invariant, for a reader with only the file open.** They never cite a review, a
  reviewer, a PR thread, a ticket, or a conversation ("the reviewer flagged…", "as discussed in #659", "review
  finding"). That context cannot be recovered from the file and ages into noise. `no-warning-comments` in
  `eslint.config.mjs` fails the lint on these phrases as a backstop.
- **Test names describe behaviour**, in the file's existing `should …, so/because …` style — not "regression for review
  comment".
- **History goes where history is kept:** the commit message may say what it addresses; the reply to the reviewer goes
  in the PR thread, as a refinement loop with the user like any other GitHub content (CLAUDE.md → Git & GitHub
  Conventions).
- **Never resolve a review thread.** The reviewer resolves their own thread once they have seen the fix.
