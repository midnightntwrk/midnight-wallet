package io.iohk.midnight.wallet.js

import cats.effect.{Deferred, IO, Ref}
import io.iohk.midnight.wallet.domain.SemanticEvent
import io.iohk.midnight.wallet.js.facades.rxjs.Subscriber
import io.iohk.midnight.wallet.util.BetterOutputSuite
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
      _ = {
        observable.subscribe(new Subscriber[Seq[SemanticEvent]] {
          override def next: js.Function1[Seq[SemanticEvent], Unit] =
            events => acc.update(old => old :+ events).unsafeRunAndForget()
          override def error: js.Function1[js.Any, Unit] = _ => ()
          override def complete: js.Function0[Unit] =
            () => isFinished.complete(()).unsafeRunAndForget()
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
      cancellation = {
        observable.subscribe(new Subscriber[Seq[SemanticEvent]] {
          override def next: js.Function1[Seq[SemanticEvent], Unit] = _ => ()
          override def error: js.Function1[js.Any, Unit] = _ => ()
          override def complete: js.Function0[Unit] =
            () => isFinished.complete(()).unsafeRunAndForget()
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
      _ = {
        observable.subscribe(new Subscriber[Seq[SemanticEvent]] {
          override def next: js.Function1[Seq[SemanticEvent], Unit] = _ => ()
          @SuppressWarnings(Array("org.wartremover.warts.ToString"))
          override def error: js.Function1[js.Any, Unit] = error => {
            errorMsg
              .set(Some(error.toString))
              .flatMap(_ => isFailed.complete(()))
              .unsafeRunAndForget()
          }
          override def complete: js.Function0[Unit] =
            () => isFinished.complete(()).unsafeRunAndForget()
        })
      }
      _ <- isFailed.get
    } yield {
      assertIO(isFinished.tryGet, None) >> assertIO(errorMsg.get, Some(error.getMessage))
    }).flatten
  }
}
