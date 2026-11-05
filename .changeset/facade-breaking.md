---
'@midnightntwrk/wallet-sdk-facade': major
---

Breaking changes since 4.x

The facade runs `@midnightntwrk/ledger-v8` below the chain's `forks.v9` and `@midnightntwrk/ledger-v9` from it, and
follows a live chain across that boundary: balances, coins and transaction history survive the crossing, and a wallet
restored from a snapshot crosses too.

- **Configuration.** `forks: { v9 }` is the protocol version from which ledger-v9 reads the chain. Left out, the facade
  presets `DefaultForkSchedule` (`ProtocolVersion.V9NativeForkSchedule`, whose `v9` is 2000000, the value a 2.x node
  reports) and hands the completed configuration to every `InitParams` factory; code outside a factory gets the same
  from `WalletFacade.resolveConfiguration(configuration)`. Proving names a backend per ledger version,
  `provers: { v8?, v9 }` (each `{ kind: 'server', url }` or `{ kind: 'wasm' }`), or one proof server under both with
  `provingServerUrl`; with neither, and no `provingService` factory, `init` throws. A custom `InitParams.provingService`
  must prove both ledger versions. No published proof-server image serves both, so a chain with ledger-v8 history wants
  a server per key; the in-process prover serves both.
- **Starting.** `start(material, options?)` takes `WalletSeeds` or `FacadeKeysByEpoch`
  (`{ v8: { shielded, dust }, v9: { shielded, dust } }`) in place of `start(shieldedSecretKeys, dustSecretKey)`. The
  `secretKeys` argument is gone from `transferTransaction`, `initSwap` and the `balance*Transaction` methods, and
  `secretKey` from `estimateTransactionFee`. A stopped facade drops its key material, so transacting after `stop()`
  fails, with `MissingStartAuxError` (from `StartMaterial` in `@midnightntwrk/wallet-sdk/runtime/abstractions`) as the
  cause. `InitParams.shielded` and `InitParams.dust` return `ShieldedWalletAPI<ShieldedKeysByEpoch>` and
  `DustWalletAPI<DustKeysByEpoch>`. A shielded or unshielded wallet passed to `init` must implement
  `revertFailedSegments` (the unshielded one also `revertUtxos` and `releaseRestoredPending`), and a Dust wallet
  `stepSync` and `ensureFeeCoverage`. `InitParams.submissionService` submits `FinalizedTx` handles rather than ledger
  transactions.
- **Transactions carry the version that built them.** Every method that took or returned a ledger transaction uses a
  `WalletTransaction` handle (`UnprovenTx`, `UnboundTx`, `FinalizedTx`, `AnyTx`), and the methods that build, sign,
  prove or submit refuse a handle for the other ledger version (`ProtocolVersionMismatchError`). As in 4.x, an error
  raised inside a wallet reaches the caller wrapped in Effect's `FiberFailure`; the facade's own checks, in
  `submitTransaction`, `finalizeTransaction` and `finalizeRecipe`, reject with the error itself. An application that
  builds its own transactions imports `@midnightntwrk/wallet-sdk/ledger/v8` or `/ledger/v9`, by the protocol version the
  wallets are acting at, and seals the result with `WalletTransaction.adopt(stage, tx, protocolVersion)`, or reads bytes
  with `adoptTransaction`. Recipes require `protocolVersion`. `finalizeTransaction` and `finalizeRecipe` keep the
  version a transaction was built at: if the chain moves to the other ledger version while it is proved, they fail with
  `ProtocolVersionMismatchError` and release what it booked.
- **Asynchronous signers.** `signRecipe`, `signUnprovenTransaction`, `signUnboundTransaction`,
  `registerNightUtxosForDustGeneration` and `deregisterFromDustGeneration` take a `SignSegment`,
  `(data: Uint8Array) => Promise<Signature>`, so a signer whose secret never enters the process (MPC, HSM) plugs in; a
  keystore's `signDataAsync` is one. Verifying keys and signatures are tagged `{ tag, value }` objects.
- **One lifecycle record per transaction.** `facade.pendingTransactionsService` is now
  `facade.transactionLifecycleService`, built by `InitParams.transactionLifecycleService(config, { clock })`.
  `FacadeState.pending` is replaced by `FacadeState.lifecycle`: one `LifecycleEntry` per transaction, carrying its
  `identifiers`, the protocol version it was authored for (`authoredFor`, an `Option`), and a `status` of `Balanced`,
  `Finalized`, `Submitted`, `Confirmed`, `PartialSuccess` (with `segments`), `Rejected` (with a `reason`: `Refused` with
  `segments`, or `TTLPassed`), `Orphaned`, `Expired` or `Reverted`. Its `transaction` is an `Option` that is `Some` once
  the transaction is finalized, and stays `none` for one that ended without being finalized or was read from an older
  store that did not hold it; `submittedAt` is `Some` once it is submitted. Ended entries stay listed until their TTL
  passes, so wait with `isAwaiting` rather than for an empty list. `FacadeState`'s constructor takes
  `(shielded, unshielded, dust, lifecycle, forkVersion?)` in place of `(shielded, unshielded, dust, pending)`. The
  service saves format `v2`: a store saved by 4.x is read and upgraded, and 4.x cannot read `v2`. A custom
  `TransactionTrait` provides `intentHashes`, `inputs` and `ttl`, and no longer `hasTTLExpired` or
  `isOneIncludedInOther`.
- **Rejections.** A first-time Dust registration whose generated Dust cannot yet pay its own fee rejects with
  `InsufficientDustForFeeError` rather than a plain `Error`. A builder (`transferTransaction`, `initSwap`, the
  `balance*Transaction` methods), `finalizeTransaction` or `finalizeRecipe` that fails part-way releases what it booked
  and rethrows the original error. If a release fails as well, it rejects with an `AggregateError` whose `errors[0]` is
  the original error, so an `instanceof` check on the rejection must look there too.
- **Sync.** `FacadeState.isSynced` and `waitForSyncedState()` also wait for the unshielded wallet's indexer-liveness
  verdict, on by default: against an indexer known to be stale they keep waiting (see the unshielded wallet's notes).
- **Transaction history.** `submitTransaction` records a pending entry, the wallets' sync records it finalized, and a
  revert, a refusal, a passed TTL or a protocol upgrade records it rejected: an orphaned one with reason
  `orphaned-by-protocol-upgrade`, a reverted one with the reason given to `revert` or `revertTransaction`, if any.
  Entries carry a `lifecycle`, and a recorded inclusion wins over a later rejection. `mergeWalletEntries` keeps a
  finalized entry over a rejected one, keeps the first writer's facts, unions `identifiers` and keeps the fields it does
  not declare.
- **Dependencies.** Depends on `@midnightntwrk/ledger-v9` `^1.0.0` beside `@midnightntwrk/ledger-v8`, so a browser
  bundle loads both ledgers' WASM modules.

Migrating from 4.x:

1. Name the proving backends (`provers`, or keep `provingServerUrl`) and, on a chain whose nodes do not report the 2.x
   fork version, `forks`.
2. Start from seeds. Derive the three wallet seeds once and start every wallet, and the facade, from them:

   ```ts
   const seeds = WalletSeeds.fromMasterSeed(masterSeed);
   const keystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, configuration.networkId);
   const facade = await WalletFacade.init({
     configuration,
     shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
     unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
     dust: (config) => DustWallet(config).startWithSeed(seeds.dust),
   });
   await facade.start(seeds); // 4.x: facade.start(shieldedSecretKeys, dustSecretKey)
   ```

3. Drop the secret keys from transacting calls, and sign asynchronously:

   ```ts
   // 4.x
   const recipe = await facade.transferTransaction(outputs, { shieldedSecretKeys, dustSecretKey }, { ttl });
   const signed = await facade.signRecipe(recipe, (data) => keystore.signData(data));
   // 5.x
   const recipe = await facade.transferTransaction(outputs, { ttl });
   const signed = await facade.signRecipe(recipe, keystore.signDataAsync);
   ```

4. Read `state.lifecycle` instead of `state.pending`, and wait with `isAwaiting`:

   ```ts
   // 4.x
   await firstValueFrom(facade.state().pipe(filter((state) => state.pending.all.length === 0)));
   // 5.x
   await firstValueFrom(facade.state().pipe(filter((state) => !state.lifecycle.some(isAwaiting))));
   ```

5. Save the lifecycle store with the service, and hand it back on the next start (`TransactionLifecycleServiceImpl`
   comes from `@midnightntwrk/wallet-sdk/capabilities/transactionLifecycle`):

   ```ts
   const stored = await facade.transactionLifecycleService.serializeState();

   await WalletFacade.init({
     // ...
     transactionLifecycleService: (config, { clock }) =>
       TransactionLifecycleServiceImpl.restore(stored, lifecycleTransactionTraits(config.forks.v9), config, clock),
   });
   ```
