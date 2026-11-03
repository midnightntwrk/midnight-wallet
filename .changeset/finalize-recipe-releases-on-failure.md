---
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(facade): give back a recipe's bookings when finalizing it fails

`finalizeRecipe` now reverts the whole recipe when any step fails, as the balancing methods do. Before, a merge or bind
that failed after the balancing part was finalized left that part pending and every coin the recipe booked unavailable
until its TTL ran out.
