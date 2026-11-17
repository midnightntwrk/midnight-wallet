---
---

Keep the e2e html reporter out of retrying CI lanes, where a retried test's bigint-bearing error crashed it and failed an
all-green run; the fork lane keeps it. Wait for generated Dust before the swap test's registration.
