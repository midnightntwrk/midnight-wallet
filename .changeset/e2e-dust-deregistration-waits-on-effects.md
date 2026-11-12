---
---

test(e2e): the Dust deregistration tests wait for the effects they assert on, not for `isSynced`, which can turn true
before every wallet has applied the transaction
