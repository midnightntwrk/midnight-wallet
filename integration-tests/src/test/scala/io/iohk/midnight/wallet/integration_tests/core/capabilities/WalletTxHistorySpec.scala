package io.iohk.midnight.wallet.integration_tests.core.capabilities

import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.capabilities.{WalletSync, WalletTxHistory}
import io.iohk.midnight.wallet.core.combinator.ProtocolVersion
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.{Generators, Wallet}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.*
import munit.CatsEffectSuite

class WalletTxHistorySpec extends WithProvingServerSuite {

  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  private lazy val txWithContext =
    Generators.txWithContextArbitrary.arbitrary.sample.get
      .fproduct(tx => ZswapChainState().tryApply(tx.transaction.guaranteedCoins))

  private lazy val walletForUpdates: IO[Wallet] =
    txWithContext.map { (tx, _) =>
      Wallet.walletCreation.create(
        Wallet.Snapshot(tx.state, Seq.empty, None, ProtocolVersion.V1),
      )
    }

  private lazy val validUpdateToApply: IO[IndexerUpdate] =
    txWithContext.map { (txCtx, _) =>
      ViewingUpdate(
        ProtocolVersion.V1,
        data.Transaction.Offset.Zero,
        Seq(
          Right(AppliedTransaction(txCtx.transaction, ApplyStage.SucceedEntirely)),
        ),
      )
    }

  test("Keep tx history") {
    given walletTxHistory: WalletTxHistory[Wallet, Transaction] = Wallet.walletTxHistory
    given walletSync: WalletSync[Wallet, IndexerUpdate] = Wallet.walletSync
    for {
      wallet <- walletForUpdates
      before = walletTxHistory.transactionHistory(wallet)
      updateToApply <- validUpdateToApply
      updated <- IO.fromEither(wallet.apply(updateToApply))
      after = walletTxHistory.transactionHistory(updated)
    } yield {
      assertEquals(before.size, 0)
      assertEquals(after.size, 1)
    }
  }

  test("Discard tx history") {
    given walletTxHistory: WalletTxHistory[Wallet, Transaction] = Wallet.walletDiscardTxHistory
    for {
      wallet <- walletForUpdates
      before = walletTxHistory.transactionHistory(wallet)
      updateToApply <- validUpdateToApply
      updated <- IO.fromEither(wallet.apply(updateToApply))
      after = walletTxHistory.transactionHistory(updated)
    } yield {
      assertEquals(before.size, 0)
      assertEquals(after.size, 0)
    }
  }
}
