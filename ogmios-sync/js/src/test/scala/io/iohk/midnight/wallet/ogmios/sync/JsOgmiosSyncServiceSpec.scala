package io.iohk.midnight.wallet.ogmios.sync

import cats.effect.{IO, Ref}
import fs2.Stream
import io.iohk.midnight.js.interop.facades.rxjs.Observable
import io.iohk.midnight.wallet.blockchain.data.Generators.*
import io.iohk.midnight.wallet.ogmios.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}

class JsOgmiosSyncServiceSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  test("Should sync") {
    // There's some issue that makes it super slow to run a forAll so just sampling 1
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val block = blockGen.sample.get
    val blockTxs = block.body.transactionResults
    val observable = new JsOgmiosSyncService(() => Stream.emit(block), IO.unit).sync()
    val firstBlock = IO.fromPromise(IO.pure(Observable.firstValueFrom(observable)))

    firstBlock.map { obtainedBlock =>
      // Compare the block
      assertEquals(obtainedBlock.header.hash, block.header.hash.value)
      assertEquals(obtainedBlock.header.parentHash, block.header.parentHash.value)
      assertEquals(obtainedBlock.header.height, block.header.height.value.toDouble)

      obtainedBlock.body.transactionResults
        .zip(blockTxs)
        .foreach { case (obtainedTx, expectedTx) =>
          val header = obtainedTx.header
          assertEquals(header.hash, expectedTx.header.hash.value)
          assertEquals(obtainedTx.body, expectedTx.body)
        }
    }
  }

  test("Should close") {
    for {
      ref <- Ref.of[IO, Boolean](false)
      service = new JsOgmiosSyncService(() => Stream.empty, ref.set(true))
      _ <- IO.fromPromise(IO.pure(service.close()))
      result <- ref.get
    } yield assert(result)
  }
}
