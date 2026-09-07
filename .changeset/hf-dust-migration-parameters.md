---
---

test(dust-wallet): cover a cross-ledger migration handed the wrong dust parameters

Test-only. The migration builds its post-fork state on parameters it is given, and the existing case asserts only the
agreeable path — that the parameters used are this ledger version's. Its fixture supplies the ledger's initial
parameters, which are also what a migration ignoring its configuration would reach for, so the assertion holds either
way.

These cases come at it from the other side: the migration accepts wrong parameters without complaint, because there is
no validation seam; a wrong generation decay rate misvalues the dust regenerated from the replay; and a wrong
night-dust ratio changes nothing observable, so a guard on that field alone would fix nothing.

Mutation-verified: a migration substituting the ledger's initial parameters for its configured ones leaves **235 of
237** unit tests green and fails only the new cases.
