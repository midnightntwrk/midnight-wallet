---
'@midnightntwrk/wallet-sdk-utilities': patch
---

Fixes and other changes since 1.2

- `HttpURL.make` and `WsURL.make` refuse a URL with the wrong scheme with a message that names it, such as
  `Invalid protocol scheme 'ftp:'. Expected 'http:' or 'https:'`, instead of `[object Object]`.
