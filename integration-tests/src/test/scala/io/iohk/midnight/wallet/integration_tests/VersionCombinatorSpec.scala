package io.iohk.midnight.wallet.integration_tests

import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.midnightNtwrkZswapV1.mod as zswapV1
import io.iohk.midnight.midnightNtwrkZswapV2.mod as zswapV2
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}
import io.iohk.midnight.wallet.core.combinator.*
import io.iohk.midnight.wallet.core.domain.ProgressUpdate
import io.iohk.midnight.wallet.core.{
  Generators,
  WalletTransactionService,
  WalletTxSubmissionService,
}
import io.iohk.midnight.wallet.zswap.given
import munit.CatsEffectSuite

class VersionCombinatorSpec extends CatsEffectSuite {
  test("Handle a different version") {
    val combinatorResource = for {
      v1 <- DummyV1Combination(Offset.Zero)
      deferred <- Deferred[IO, Unit].toResource
    } yield new VersionCombinator(v1, new DummyCombinationMigrations, deferred)

    combinatorResource.use { combinator =>
      for {
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
  }

  test("Stop successfully") {
    val combinatorResource = for {
      combination <- NeverEndingCombination()
      bloc <- Bloc[VersionCombination](combination)
      deferred <- Deferred[IO, Unit].toResource
    } yield (deferred, new VersionCombinator(bloc, CombinationMigrations.default, deferred))

    combinatorResource.use { (deferred, combinator) =>
      for {
        fiber <- combinator.sync.start
        _ <- deferred.complete(())
        _ <- fiber.joinWithNever
      } yield ()
    }
  }
}

class NeverEndingCombination(localState: Bloc[Int]) extends VersionCombination {
  override def sync: IO[Unit] =
    Stream
      .constant[IO, Int](1)
      .evalTap(localState.set)
      .compile
      .drain

  override def state: Stream[IO, State[
    CoinPublicKey,
    EncPublicKey,
    EncryptionSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    Transaction,
  ]] =
    UnsupportedOperationException("Test").raiseError

  override def serializeState: IO[SerializedWalletState] =
    UnsupportedOperationException("Test").raiseError

  override def transactionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTransactionService[UnprovenTransaction, Transaction, CoinInfo, TokenType]] =
    UnsupportedOperationException("Test").raiseError

  override def submissionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTxSubmissionService[Transaction]] =
    UnsupportedOperationException("Test").raiseError
}

object NeverEndingCombination {
  def apply(): Resource[IO, NeverEndingCombination] =
    Bloc[Int](1).map(new NeverEndingCombination(_))
}

class DummyV1Combination(val localState: Bloc[Offset]) extends VersionCombination {
  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  override def state: Stream[IO, State[
    CoinPublicKey,
    EncPublicKey,
    EncryptionSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    Transaction,
  ]] =
    localState.subscribe
      .takeWhile(_ <= Offset(9))
      .map { offset =>
        Generators.WalletStateGen.sample.get.copy(
          encryptionPublicKey = DummyV1Combination.zswapState.encryptionPublicKey,
          syncProgress = ProgressUpdate(Offset(1), offset),
        )
      }

  override def serializeState: IO[SerializedWalletState] =
    SerializedWalletState("DummyV1").pure

  override def sync: IO[Unit] =
    Stream
      .range[IO, BigInt](1, 11)
      .map(Offset(_))
      .evalMap(localState.set)
      .compile
      .drain

  override def transactionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTransactionService[
    UnprovenTransaction,
    Transaction,
    CoinInfo,
    TokenType,
  ]] = Exception("Test stub").raiseError

  override def submissionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTxSubmissionService[
    Transaction,
  ]] = Exception("Test stub").raiseError
}

object DummyV1Combination {
  val zswapState: zswapV1.LocalState = zswapV1.LocalState()

  def apply(initialOffset: Offset): Resource[IO, Bloc[VersionCombination]] =
    Bloc[Offset](initialOffset)
      .map(new DummyV1Combination(_))
      .flatMap(Bloc[VersionCombination](_))
}

class DummyV2Combination(val localState: Bloc[Offset]) extends VersionCombination {
  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  override def state: Stream[IO, State[
    CoinPublicKey,
    EncPublicKey,
    EncryptionSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    Transaction,
  ]] =
    localState.subscribe
      .map { offset =>
        Generators.WalletStateGen.sample.get.copy(
          encryptionPublicKey = DummyV2Combination.zswapState.encryptionPublicKey,
          syncProgress = ProgressUpdate(Offset(2), offset),
        )
      }

  override def serializeState: IO[SerializedWalletState] =
    SerializedWalletState("DummyV2").pure

  override def sync: IO[Unit] =
    Stream
      .iterate[IO, BigInt](11)(_ + 1)
      .map(Offset(_))
      .evalMap(localState.set)
      .compile
      .drain

  override def transactionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTransactionService[
    UnprovenTransaction,
    Transaction,
    CoinInfo,
    TokenType,
  ]] = Exception("Test stub").raiseError

  override def submissionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTxSubmissionService[
    Transaction,
  ]] = Exception("Test stub").raiseError
}

object DummyV2Combination {
  val zswapState: zswapV2.LocalState = zswapV2.LocalState()
}

class DummyCombinationMigrations extends CombinationMigrations {
  override def migrate(versionCombination: VersionCombination): IO[VersionCombination] =
    versionCombination match {
      case v1: DummyV1Combination =>
        for {
          currentState <- v1.localState.subscribe.head.compile.lastOrError
          bloc <- Bloc(currentState).allocated._1F
        } yield new DummyV2Combination(bloc)
    }
}
