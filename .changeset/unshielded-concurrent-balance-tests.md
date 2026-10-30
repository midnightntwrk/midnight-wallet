---
---

test(unshielded-wallet): check that two balance calls queued on one wallet each book a different coin, and that the
second fails with insufficient funds once the first has booked the only coin, through both `balanceUnprovenTransaction`
and `balanceUnboundTransaction`, in both the V1 and V2 variants
