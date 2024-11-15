package io.iohk.midnight.wallet.core.combinator

import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.wallet.core.services.{ProvingService, SyncService, TxSubmissionService}
import io.iohk.midnight.wallet.zswap

class VersionCombinator(
    currentCombination: Bloc[VersionCombination],
    combinationMigrations: CombinationMigrations,
    deferred: Deferred[IO, Unit],
) {
  def sync: IO[Unit] =
    currentCombination.subscribe
      .interruptWhen(deferred.get.attempt)
      .evalTap(_.sync)
      .evalMap(migrate)
      .evalMap(currentCombination.set)
      .compile
      .drain

  private def migrate(versionCombination: VersionCombination): IO[VersionCombination] =
    combinationMigrations.migrate(versionCombination)

  def state: Stream[
    IO,
    WalletStateService.State[
      v1.CoinPublicKey,
      v1.EncPublicKey,
      v1.EncryptionSecretKey,
      v1.TokenType,
      v1.QualifiedCoinInfo,
      v1.CoinInfo,
      v1.Nullifier,
      v1.Transaction,
    ],
  ] =
    currentCombination.subscribe.flatMap(_.state)

  def transactionService(
      protocolVersion: ProtocolVersion,
  ): IO[
    WalletTransactionService[v1.UnprovenTransaction, v1.Transaction, v1.CoinInfo, v1.TokenType],
  ] =
    currentCombination.subscribe.head.compile.lastOrError
      .flatMap(_.transactionService(protocolVersion))

  def submissionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTxSubmissionService[v1.Transaction]] =
    currentCombination.subscribe.head.compile.lastOrError
      .flatMap(_.submissionService(protocolVersion))

  def serializeState: IO[SerializedWalletState] =
    currentCombination.subscribe.head.compile.lastOrError.flatMap(_.serializeState)
}

object VersionCombinator {
  trait SubmissionServiceFactory {
    def apply[TX: zswap.Transaction.IsSerializable](using
        zswap.NetworkId,
    ): Resource[IO, TxSubmissionService[TX]]
  }
  trait ProvingServiceFactory {
    def apply[UTX: zswap.UnprovenTransaction.IsSerializable, TX: zswap.Transaction.IsSerializable](
        using
        ProtocolVersion,
        zswap.NetworkId,
    ): Resource[IO, ProvingService[UTX, TX]]
  }
  trait SyncServiceFactory {
    def apply[ESK](esk: ESK, offset: Option[BigInt])(using
        zswap.EncryptionSecretKey[ESK, ?],
        zswap.NetworkId,
    ): Resource[IO, SyncService]
  }

  def apply(
      config: Config,
      submissionServiceFactory: SubmissionServiceFactory,
      provingServiceFactory: ProvingServiceFactory,
      syncServiceFactory: SyncServiceFactory,
      combinationMigrations: CombinationMigrations,
  )(using Tracer[IO, StructuredLog]): Resource[IO, VersionCombinator] =
    for {
      (protocolVersion, networkId) <- parseParams(config.initialState).toResource
      given zswap.NetworkId = networkId
      initialCombination <- buildInitialCombination(
        protocolVersion,
        config,
        submissionServiceFactory,
        provingServiceFactory,
        syncServiceFactory,
      )
      bloc <- Bloc[VersionCombination](initialCombination)
      deferred <- Resource.make(Deferred[IO, Unit])(_.complete(()).void)
    } yield new VersionCombinator(bloc, combinationMigrations, deferred)

  private def parseParams(
      config: Config.InitialState,
  ): IO[(ProtocolVersion, zswap.NetworkId)] =
    (config match {
      case Config.InitialState.CreateNew(networkId) =>
        (ProtocolVersion.V1, networkId).asRight
      case Config.InitialState.Seed(_, networkId) =>
        (ProtocolVersion.V1, networkId).asRight
      case Config.InitialState.SerializedSnapshot(serialized) =>
        V1Combination.snapshotInstances.parse(serialized).map(s => (s.protocolVersion, s.networkId))
    }).liftTo[IO]

  private def buildInitialCombination(
      protocolVersion: ProtocolVersion,
      config: Config,
      submissionServiceFactory: SubmissionServiceFactory,
      provingServiceFactory: ProvingServiceFactory,
      syncServiceFactory: SyncServiceFactory,
  )(using zswap.NetworkId, Tracer[IO, StructuredLog]): Resource[IO, VersionCombination] =
    protocolVersion match {
      case ProtocolVersion.V1 =>
        import zswap.given
        given ProtocolVersion = ProtocolVersion.V1
        V1Combination(
          config,
          submissionServiceFactory[v1.Transaction],
          provingServiceFactory[v1.UnprovenTransaction, v1.Transaction],
          syncServiceFactory[v1.EncryptionSecretKey],
        )
    }
}
