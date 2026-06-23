---
'@midnightntwrk/wallet-sdk-indexer-client': patch
---

Remove unused devDependencies `@graphql-codegen/typescript` and
`@graphql-codegen/typescript-operations`. They are bundled transitively by
`@graphql-codegen/client-preset` (used via `preset: 'client'` in `codegen.ts`),
so dropping them as direct dependencies has no effect on code generation or the
published package.
