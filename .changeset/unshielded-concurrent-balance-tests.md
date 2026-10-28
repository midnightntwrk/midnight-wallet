---
---

test(unshielded-wallet): check that two balance calls running at once on one wallet each book a different coin, and
that the second fails with insufficient funds once the first has booked the only coin, in both the V1 and V2 variants
