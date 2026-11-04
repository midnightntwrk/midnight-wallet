---
'@midnightntwrk/wallet-sdk-utilities': patch
---

Fixes and other changes since 1.2

- `HttpURL.make` and `WsURL.make` refuse a URL with the wrong scheme with a message that names it, such as
  `Invalid protocol scheme 'ftp:'. Expected 'http:' or 'https:'`, instead of `[object Object]`.
- The `./testing` containers default to proof server `9.0.0-rc.10` (was `8.1.0`) and to node and node toolkit
  `2.1.0-rc.4` (was `0.22.0`).
