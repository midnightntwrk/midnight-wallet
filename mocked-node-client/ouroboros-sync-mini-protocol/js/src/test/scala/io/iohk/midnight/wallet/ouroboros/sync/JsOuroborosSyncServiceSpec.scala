package io.iohk.midnight.wallet.ouroboros.sync

import cats.effect.{IO, Ref}
import fs2.Stream
import io.iohk.midnight.js.interop.rxjs.Observable
import io.iohk.midnight.wallet.ouroboros.sync.TestDomain.Block
import io.iohk.midnight.wallet.ouroboros.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}

class JsOuroborosSyncServiceSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {

  test("Should sync") {
    // There's some issue that makes it super slow to run a forAll so just sampling 1
    @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
    val block = Generators.blockGen.sample.get

    @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
    val syncService = new OuroborosSyncService[IO, Block] {
      override def sync: Stream[IO, Block] = Stream.emit(block)
    }

    val observable = new JsOuroborosSyncService(syncService, IO.unit).sync()
    val firstBlock = IO.fromPromise(IO.pure(Observable.firstValueFrom(observable)))

    firstBlock.map { obtainedBlock => assertEquals(obtainedBlock, block) }
  }

  test("Should close") {
    val emptySyncService = new OuroborosSyncService[IO, Block] {
      override def sync: Stream[IO, Block] = Stream.empty
    }

    for {
      ref <- Ref.of[IO, Boolean](false)
      service = new JsOuroborosSyncService(emptySyncService, ref.set(true))
      _ <- IO.fromPromise(IO.pure(service.close()))
      result <- ref.get
    } yield assert(result)
  }
}
