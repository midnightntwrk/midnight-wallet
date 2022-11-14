package io.iohk.midnight.wallet.core

import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.wallet.blockchain.util.implicits.Equality.*
import io.iohk.midnight.wallet.core.services.SyncServiceStub
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.CatsEffectSuite
import org.scalacheck.Gen

class WalletFilterServiceSpec extends CatsEffectSuite with BetterOutputSuite {
  test("Syncs transactions") {
    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val blocks =
      Gen
        .listOfN(2, Generators.transactionGen)
        .flatMap(tx => Gen.listOfN(2, Generators.blockGen(tx)))
        .sample
        .get

    val wallet = new WalletFilterService.Live[IO](new SyncServiceStub(blocks))
    wallet
      .installTransactionFilter(_ => true)
      .compile
      .to(List)
      .map { result =>
        val obtained = result.map(LedgerSerialization.toTransaction(_).header.hash)
        val expected = blocks.flatMap(_.body.transactionResults.map(_.header.hash))
        assertEquals(obtained, expected)
      }
  }
  test("Filters transactions") {
    val blockTxGen = for {
      tx <- Generators.transactionGen
      txs <- Gen.listOfN(2, Generators.transactionGen)
      block <- Generators.blockGen(tx :: txs)
    } yield (block, tx)

    // Taking just a sample because tx building is slow
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val sample = blockTxGen.sample.get

    val wallet = new WalletFilterService.Live[IO](new SyncServiceStub(Seq(sample._1)))
    wallet
      .installTransactionFilter(
        LedgerSerialization.toTransaction(_).header.hash === sample._2.header.hash,
      )
      .compile
      .to(Seq)
      .map { result =>
        val obtained = result.map(LedgerSerialization.toTransaction(_).header.hash)
        val expected = Seq(sample._2.header.hash)
        assertEquals(obtained, expected)
      }
  }
}
