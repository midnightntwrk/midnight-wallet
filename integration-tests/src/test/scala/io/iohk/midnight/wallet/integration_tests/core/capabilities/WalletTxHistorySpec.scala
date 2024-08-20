package io.iohk.midnight.wallet.integration_tests.core.capabilities

import cats.effect.IO
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.Generators.{TransactionWithContext, txWithContextArbitrary}
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.{Generators, Wallet}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.*
import munit.CatsEffectSuite
import org.scalacheck.effect.PropF.forAllF

class WalletTxHistorySpec extends WithProvingServerSuite {
  private def walletForUpdates(txWithContext: TransactionWithContext): Wallet =
    Wallet.walletCreation.create(
      Wallet.Snapshot(
        txWithContext.state,
        Seq.empty,
        None,
        data.ProtocolVersion.V1,
        NetworkId.Undeployed,
      ),
    )

  private def validUpdateToApply(txWithContext: TransactionWithContext): IndexerUpdate =
    ViewingUpdate(
      data.ProtocolVersion.V1,
      data.Transaction.Offset.Zero,
      Seq(
        Right(AppliedTransaction(txWithContext.transaction, ApplyStage.SucceedEntirely)),
      ),
    )

  test("Keep tx history") {
    given walletTxHistory: WalletTxHistory[Wallet, Transaction] = Wallet.walletTxHistory
    forAllF { (txWithContext: IO[TransactionWithContext]) =>
      for {
        tx <- txWithContext
        wallet = walletForUpdates(tx)
        before = walletTxHistory.transactionHistory(wallet)
        updateToApply = validUpdateToApply(tx)
        updated <- IO.fromEither(wallet.apply(updateToApply))
        after = walletTxHistory.transactionHistory(updated)
      } yield {
        assertEquals(before.size, 0)
        assertEquals(after.size, 1)
      }
    }
  }

  test("Discard tx history") {
    given walletTxHistory: WalletTxHistory[Wallet, Transaction] = Wallet.walletDiscardTxHistory
    forAllF { (txWithContext: IO[TransactionWithContext]) =>
      for {
        tx <- txWithContext
        wallet = walletForUpdates(tx)
        before = walletTxHistory.transactionHistory(wallet)
        updateToApply = validUpdateToApply(tx)
        updated <- IO.fromEither(wallet.apply(updateToApply))
        after = walletTxHistory.transactionHistory(updated)
      } yield {
        assertEquals(before.size, 0)
        assertEquals(after.size, 0)
      }
    }
  }
}
