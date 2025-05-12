package io.iohk.midnight.wallet.integration_tests.core.capabilities

import cats.effect.IO
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.Generators.{TransactionWithContext, txWithContextArbitrary}
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.{
  Generators,
  Snapshot,
  SnapshotInstances,
  WalletInstances,
  Wallet as CoreWallet,
}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.given
import munit.CatsEffectSuite
import org.scalacheck.effect.PropF.forAllF

@SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
class WalletTxHistorySpec extends WithProvingServerSuite {
  private given snapshots: SnapshotInstances[LocalState, Transaction] = new SnapshotInstances
  private val wallets: WalletInstances[
    LocalState,
    SecretKeys,
    Transaction,
    TokenType,
    Offer,
    ProofErasedTransaction,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    CoinPublicKey,
    EncryptionSecretKey,
    EncPublicKey,
    CoinSecretKey,
    UnprovenInput,
    ProofErasedOffer,
    MerkleTreeCollapsedUpdate,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenOutput,
  ] = new WalletInstances

  import wallets.given
  type Wallet = CoreWallet[LocalState, SecretKeys, Transaction]

  private def walletForUpdates(txWithContext: TransactionWithContext): Wallet =
    walletCreation.create(
      zswap.HexUtil.decodeHex(zswap.HexUtil.randomHex()).get,
      Snapshot(
        txWithContext.state,
        Seq.empty,
        None,
        data.ProtocolVersion.V1,
        zswap.NetworkId.Undeployed,
      ),
    )

  private def validUpdateToApply(
      txWithContext: TransactionWithContext,
  ): IndexerUpdate[MerkleTreeCollapsedUpdate, Transaction] =
    ViewingUpdate(
      data.ProtocolVersion.V1,
      data.Transaction.Offset.Zero,
      Seq(
        Right(AppliedTransaction(txWithContext.transaction, ApplyStage.SucceedEntirely)),
      ),
    )

  test("Keep tx history") {
    given keepHistory: WalletTxHistory[Wallet, Transaction] = wallets.walletTxHistory
    forAllF { (txWithContext: IO[TransactionWithContext]) =>
      for {
        tx <- txWithContext
        wallet = walletForUpdates(tx)
        before = keepHistory.transactionHistory(wallet)
        updateToApply = validUpdateToApply(tx)
        updated <- IO.fromEither(wallet.apply(updateToApply))
        after = keepHistory.transactionHistory(updated)
      } yield {
        assertEquals(before.size, 0)
        assertEquals(after.size, 1)
      }
    }
  }

  test("Discard tx history") {
    given discard: WalletTxHistory[Wallet, Transaction] = wallets.walletDiscardTxHistory
    forAllF { (txWithContext: IO[TransactionWithContext]) =>
      for {
        tx <- txWithContext
        wallet = walletForUpdates(tx)
        before = discard.transactionHistory(wallet)
        updateToApply = validUpdateToApply(tx)
        updated <- IO.fromEither(wallet.apply(updateToApply))
        after = discard.transactionHistory(updated)
      } yield {
        assertEquals(before.size, 0)
        assertEquals(after.size, 0)
      }
    }
  }
}
