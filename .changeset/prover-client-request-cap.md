---
'@midnightntwrk/wallet-sdk-prover-client': patch
'@midnightntwrk/wallet-sdk-capabilities': patch
---

fix(prover-client): cap how many requests the HTTP prover client has waiting at a proof server at once, at 10 unless
`maxConcurrentRequests` says otherwise; requests past the cap are held back and sent as earlier ones are answered

A transaction with more proofs than a proof server has room for in its queue used to have the proofs past that refused
with `Job Queue full`, which failed the whole transaction. `HttpProverClient.create` and `HttpProverClient.layer` can
now also fail with `InvalidMaxConcurrentRequestsError`, when `maxConcurrentRequests` is not a whole number of at least
one; `fromV8ProvingProviderEffect` and `fromV9ProvingProviderEffect` in capabilities accept a provider that fails that
way.
