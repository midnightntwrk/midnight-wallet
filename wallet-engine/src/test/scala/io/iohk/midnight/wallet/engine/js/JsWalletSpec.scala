package io.iohk.midnight.wallet.engine.js

import cats.effect.{Deferred, IO, Ref}
import io.iohk.midnight.wallet.core.domain.SemanticEvent
import io.iohk.midnight.wallet.core.js.facades.rxjs.{Operators, Subscriber}
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite
import munit.CatsEffectSuite

import java.util.concurrent.TimeUnit
import scala.concurrent.duration.FiniteDuration
import scala.scalajs.js

trait JsWalletFixtures {
  val events: Seq[Seq[SemanticEvent]] =
    Seq.range(0, 100).grouped(10).map(_.map(SemanticEvent)).toSeq
  val error = new RuntimeException("error")
  val jsWallet: JsWallet = new JsWallet(new WalletSyncStub(events), IO.unit)
  val jsFailingWallet: JsWallet = new JsWallet(new WalletSyncFailingStub(events, error), IO.unit)
  val jsInfiniteWallet: JsWallet = new JsWallet(new WalletSyncInfiniteStub, IO.unit)
}

class JsWalletSpec extends CatsEffectSuite with JsWalletFixtures with BetterOutputSuite {
  test("Run sync and get finished message") {
    (for {
      acc <- Ref.of[IO, Seq[Seq[SemanticEvent]]](Seq.empty[Seq[SemanticEvent]])
      isFinished <- Deferred[IO, Unit]
      observable = jsWallet.sync()
      _ <- IO {
        observable.subscribe(new Subscriber[Seq[SemanticEvent]] {
          override def next(events: Seq[SemanticEvent]): Unit =
            acc.update(old => old :+ events).unsafeRunAndForget()
          override def error(error: js.Any): Unit = ()
          override def complete(): Unit = isFinished.complete(()).unsafeRunAndForget()
        })
      }
      _ <- isFinished.get
    } yield {
      assertIO(acc.get, events)
    }).flatten
  }

  // will never finish - we will match error case - in case of having wrong form of Observer interface ('next' as a function not method)
  test("Run sync with map operator and get finished message") {
    (for {
      acc <- Ref.of[IO, Seq[Seq[SemanticEvent]]](Seq.empty[Seq[SemanticEvent]])
      isFinished <- Deferred[IO, Unit]
      // sync with dummy map operator - map is executing `subscriber.next` rapidly, which is failing in case of using functions in the interface
      observable = jsWallet
        .sync()
        .pipe(Operators.map((arg1: Seq[SemanticEvent], _: Int) => arg1))
      _ <- IO {
        observable.subscribe(new Subscriber[Seq[SemanticEvent]] {
          override def next(events: Seq[SemanticEvent]): Unit =
            acc.update(old => old :+ events).unsafeRunAndForget()
          override def error(error: js.Any): Unit = ()
          override def complete(): Unit = isFinished.complete(()).unsafeRunAndForget()
        })
      }
      _ <- isFinished.get
    } yield {
      assertIO(acc.get, events)
    }).flatten
  }

  test("Run sync and cancel it before stream finished") {
    (for {
      isFinished <- Deferred[IO, Unit]
      isUnsubscribed <- Deferred[IO, Unit]
      observable = jsInfiniteWallet.sync()
      cancellation <- IO {
        observable.subscribe(new Subscriber[Seq[SemanticEvent]] {
          override def next(value: Seq[SemanticEvent]): Unit = ()
          override def error(error: js.Any): Unit = ()
          override def complete(): Unit = isFinished.complete(()).unsafeRunAndForget()
        })
      }
      _ <- IO(cancellation.unsubscribe()).delayBy(FiniteDuration(1, TimeUnit.SECONDS))
      _ <- isUnsubscribed.complete(())
      _ <- isUnsubscribed.get
    } yield {
      assertIO(isFinished.tryGet, None)
    }).flatten
  }

  test("Run sync and process error, don't run complete clause") {
    (for {
      errorMsg <- Ref.of[IO, Option[String]](None)
      isFinished <- Deferred[IO, Unit]
      isFailed <- Deferred[IO, Unit]
      observable = jsFailingWallet.sync()
      _ <- IO {
        observable.subscribe(new Subscriber[Seq[SemanticEvent]] {
          override def next(value: Seq[SemanticEvent]): Unit = ()
          @SuppressWarnings(Array("org.wartremover.warts.ToString"))
          override def error(error: js.Any): Unit = errorMsg
            .set(Some(error.toString))
            .flatMap(_ => isFailed.complete(()))
            .unsafeRunAndForget()
          override def complete(): Unit = isFinished.complete(()).unsafeRunAndForget()
        })
      }
      _ <- isFailed.get
    } yield {
      assertIO(isFinished.tryGet, None) >> assertIO(errorMsg.get, Some(error.getMessage))
    }).flatten
  }
}
