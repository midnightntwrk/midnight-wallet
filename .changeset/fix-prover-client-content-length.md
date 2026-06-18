---
'@midnightntwrk/wallet-sdk-prover-client': patch
---

Fix proof-server requests failing with `invalid content-length header` when undici >= 8.2.0 is
installed as the process-wide fetch dispatcher (which happens transitively by merely importing
packages such as testcontainers or @effect/platform-node). The HTTP prover client no longer sets
an explicit `content-length` request header and lets `fetch` derive it from the body instead.
