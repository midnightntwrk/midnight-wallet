---
'@midnightntwrk/wallet-sdk-prover-client': patch
'@midnightntwrk/wallet-sdk-capabilities': patch
---

fix(prover-client): prove a transaction with more proofs than a proof server queues

A transaction with more proofs than a proof server has room for in its queue used to have the proofs past that refused
with `Job Queue full`, which failed the whole transaction. The HTTP prover client now does two things about it.

It has at most 10 requests waiting at a proof server at once, unless `maxConcurrentRequests` says otherwise; requests
past the cap are held back and sent as earlier ones are answered. `HttpProverClient.create` and `HttpProverClient.layer`
can now also fail with `InvalidMaxConcurrentRequestsError`, when `maxConcurrentRequests` is not a whole number of at
least one; `fromV8ProvingProviderEffect` and `fromV9ProvingProviderEffect` in capabilities accept a provider that fails
that way. A wallet sets the cap per proof server backend, with `maxConcurrentRequests` beside `url` in `provers`, and
`ServerProvingConfiguration` takes it too; `provingServerUrl` always uses the default. A backend keeps one client, so
the cap holds across the transactions it is proving at once.

It sends a request again when the proof server could not take it: when its queue was full (HTTP 429), which is what
carries a transaction through a proof server that other clients are also using, and on HTTP 502, 503 and 504, which used
to be sent again only when the reply broke off before it could be read. It waits 1 second, doubling up to 10 seconds,
for 5 minutes in all, unless `retrySchedule` says otherwise. Any other reply still fails the request at once. A request
the proof server has not answered within 10 minutes is given up, which fails the proof.
