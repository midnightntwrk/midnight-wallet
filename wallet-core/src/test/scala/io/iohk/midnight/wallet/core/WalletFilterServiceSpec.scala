package io.iohk.midnight.wallet.core

import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.blockchain.util.implicits.Equality.*
import io.iohk.midnight.wallet.core.services.SyncServiceStub
import io.iohk.midnight.wallet.core.tracing.WalletFilterTracer
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.CatsEffectSuite
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF

class WalletFilterServiceSpec extends CatsEffectSuite with BetterOutputSuite {

  implicit val filterTracer: WalletFilterTracer[IO] = WalletFilterTracer.from(Tracer.noOpTracer)

  test("Syncs transactions") {
    val blocksGen =
      Gen
        .listOfN(2, Generators.transactionGen)
        .flatMap(tx => Gen.listOfN(2, Generators.blockGen(tx)))

    forAllF(blocksGen) { blocks =>
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
  }
  test("Filters transactions") {
    val blockTxGen: Gen[(Block, Transaction)] = for {
      tx <- Generators.transactionGen
      txs <- Gen.listOfN(2, Generators.transactionGen)
      block <- Generators.blockGen(tx :: txs)
    } yield (block, tx)

    forAllF(blockTxGen) { blocksWithTx =>
      val (block, tx) = blocksWithTx

      val wallet = new WalletFilterService.Live[IO](new SyncServiceStub(Seq(block)))
      wallet
        .installTransactionFilter(
          LedgerSerialization.toTransaction(_).header.hash === tx.header.hash,
        )
        .compile
        .to(Seq)
        .map { result =>
          val obtained = result.map(LedgerSerialization.toTransaction(_).header.hash)
          val expected = Seq(tx.header.hash)
          assertEquals(obtained, expected)
        }
    }
  }
}
