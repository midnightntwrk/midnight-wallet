package io.iohk.midnight.wallet.integration_tests

import cats.effect.{Async, Deferred, IO, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.midnightNtwrkZswapV1.mod as zswapV1
import io.iohk.midnight.midnightNtwrkZswapV2.mod as zswapV2
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset
import io.iohk.midnight.wallet.core.Generators
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}
import io.iohk.midnight.wallet.core.combinator.*
import io.iohk.midnight.wallet.core.domain.ProgressUpdate
import io.iohk.midnight.wallet.zswap.CoinPublicKey
import munit.CatsEffectSuite

class VersionCombinatorSpec extends CatsEffectSuite {
  test("Handle a different version") {
    for {
      v1 <- DummyV1Combination[IO](Offset.Zero)
      deferred <- Deferred[IO, Unit]
      combinator = new VersionCombinator[IO](v1, DummyCombinationMigrations[IO], deferred)
      initialState <- combinator.serializeState
      fiber <- combinator.state
        .take(20)
        .compile
        .toList
        .map(_.toNeSeq.getOrElse(fail("After .take(20) this shouldn't happen")))
        .start
      _ <- combinator.sync.start
      states <- fiber.joinWithNever
      finalState <- combinator.serializeState
    } yield {
      assertEquals(initialState, SerializedWalletState("DummyV1"))
      assertEquals(finalState, SerializedWalletState("DummyV2"))
      assertEquals(
        states.map(_.syncProgress).toList,
        List.tabulate(10)(n => ProgressUpdate(Offset(1), Offset(n))) ++
          List.tabulate(10)(n => ProgressUpdate(Offset(2), Offset(n + 10))),
        states.map(_.syncProgress).toList,
      )
      assertEquals(
        states.head.encryptionPublicKey,
        DummyV1Combination.zswapState.encryptionPublicKey,
      )
      assertEquals(
        states.last.encryptionPublicKey,
        DummyV2Combination.zswapState.encryptionPublicKey,
      )
    }
  }

  test("Stop successfully") {
    val resource =
      NeverEndingCombination[IO]
        .flatMap(VersionCombinator.apply(_, CombinationMigrations.default))

    for {
      (combinator, finalizer) <- resource.allocated
      fiber <- combinator.sync.start
      _ <- finalizer
      _ <- fiber.joinWithNever
    } yield ()
  }
}

class NeverEndingCombination[F[_]: Async](localState: Bloc[F, Int]) extends VersionCombination[F] {
  override def sync: F[Unit] =
    Stream
      .constant[F, Int](1)
      .evalTap(localState.set)
      .compile
      .drain

  override def state: Stream[F, State] =
    UnsupportedOperationException("Test").raiseError

  override def serializeState: F[SerializedWalletState] =
    UnsupportedOperationException("Test").raiseError
}

object NeverEndingCombination {
  def apply[F[_]: Async]: Resource[F, NeverEndingCombination[F]] =
    Bloc[F, Int](1).map(new NeverEndingCombination[F](_))
}

class DummyV1Combination[F[_]: Async](val localState: Bloc[F, Offset])
    extends VersionCombination[F] {
  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  override def state: Stream[F, State] =
    localState.subscribe
      .takeWhile(_ <= Offset(9))
      .map { offset =>
        Generators.WalletStateGen.sample.get.copy(
          encryptionPublicKey = DummyV1Combination.zswapState.encryptionPublicKey,
          syncProgress = ProgressUpdate(Offset(1), offset),
        )
      }

  override def serializeState: F[SerializedWalletState] =
    SerializedWalletState("DummyV1").pure

  override def sync: F[Unit] =
    Stream
      .range[F, BigInt](1, 11)
      .map(Offset(_))
      .evalMap(localState.set)
      .compile
      .drain
}

object DummyV1Combination {
  val zswapState: zswapV1.LocalState = zswapV1.LocalState()

  def apply[F[_]: Async](initialOffset: Offset): F[Bloc[F, VersionCombination[F]]] =
    Bloc[F, Offset](initialOffset).allocated._1F
      .map(new DummyV1Combination[F](_))
      .flatMap(Bloc[F, VersionCombination[F]](_).allocated._1F)
}

class DummyV2Combination[F[_]: Async](val localState: Bloc[F, Offset])
    extends VersionCombination[F] {
  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  override def state: Stream[F, State] =
    localState.subscribe
      .map { offset =>
        Generators.WalletStateGen.sample.get.copy(
          encryptionPublicKey = DummyV2Combination.zswapState.encryptionPublicKey,
          syncProgress = ProgressUpdate(Offset(2), offset),
        )
      }

  override def serializeState: F[SerializedWalletState] =
    SerializedWalletState("DummyV2").pure

  override def sync: F[Unit] =
    Stream
      .iterate[F, BigInt](11)(_ + 1)
      .map(Offset(_))
      .evalMap(localState.set)
      .compile
      .drain
}

object DummyV2Combination {
  val zswapState: zswapV2.LocalState = zswapV2.LocalState()
}

class DummyCombinationMigrations[F[_]: Async] extends CombinationMigrations[F] {
  override def migrate(versionCombination: VersionCombination[F]): F[VersionCombination[F]] =
    versionCombination match {
      case v1: DummyV1Combination[F] =>
        for {
          currentState <- v1.localState.subscribe.head.compile.lastOrError
          bloc <- Bloc(currentState).allocated._1F
        } yield new DummyV2Combination[F](bloc)
    }
}
