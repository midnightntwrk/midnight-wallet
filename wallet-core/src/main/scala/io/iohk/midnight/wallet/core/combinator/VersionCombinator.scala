package io.iohk.midnight.wallet.core.combinator

import cats.ApplicativeThrow
import cats.effect.{Async, Deferred, Resource}
import cats.effect.syntax.resource.*
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.core.services.{ProvingService, SyncService, TxSubmissionService}
import io.iohk.midnight.wallet.zswap

class VersionCombinator[F[_]: Async](
    currentCombination: Bloc[F, VersionCombination[F]],
    combinationMigrations: CombinationMigrations[F],
    deferred: Deferred[F, Unit],
) {
  def sync: F[Unit] =
    currentCombination.subscribe
      .interruptWhen(deferred.get.attempt)
      .evalTap(_.sync)
      .evalMap(migrate)
      .evalMap(currentCombination.set)
      .compile
      .drain

  private def migrate(versionCombination: VersionCombination[F]): F[VersionCombination[F]] =
    combinationMigrations.migrate(versionCombination)

  def state: Stream[
    F,
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
  ): F[
    WalletTransactionService[F, v1.UnprovenTransaction, v1.Transaction, v1.CoinInfo, v1.TokenType],
  ] =
    currentCombination.subscribe.head.compile.lastOrError
      .flatMap(_.transactionService(protocolVersion))

  def submissionService(
      protocolVersion: ProtocolVersion,
  ): F[WalletTxSubmissionService[F, v1.Transaction]] =
    currentCombination.subscribe.head.compile.lastOrError
      .flatMap(_.submissionService(protocolVersion))

  def serializeState: F[SerializedWalletState] =
    currentCombination.subscribe.head.compile.lastOrError.flatMap(_.serializeState)
}

object VersionCombinator {
  trait SubmissionServiceFactory[F[_]] {
    def apply[TX: zswap.Transaction.IsSerializable](using
        zswap.NetworkId,
    ): Resource[F, TxSubmissionService[F, TX]]
  }
  trait ProvingServiceFactory[F[_]] {
    def apply[UTX: zswap.UnprovenTransaction.IsSerializable, TX: zswap.Transaction.IsSerializable](
        using
        ProtocolVersion,
        zswap.NetworkId,
    ): Resource[F, ProvingService[F, UTX, TX]]
  }
  trait SyncServiceFactory[F[_]] {
    def apply[ESK](esk: ESK, offset: Option[BigInt])(using
        zswap.EncryptionSecretKey[ESK, ?],
        zswap.NetworkId,
    ): Resource[F, SyncService[F]]
  }

  def apply[F[_]: Async](
      config: Config,
      submissionServiceFactory: SubmissionServiceFactory[F],
      provingServiceFactory: ProvingServiceFactory[F],
      syncServiceFactory: SyncServiceFactory[F],
      combinationMigrations: CombinationMigrations[F],
  )(using Tracer[F, StructuredLog]): Resource[F, VersionCombinator[F]] =
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
      bloc <- Bloc[F, VersionCombination[F]](initialCombination)
      deferred <- Resource.make(Deferred[F, Unit])(_.complete(()).void)
    } yield new VersionCombinator(bloc, combinationMigrations, deferred)

  private def parseParams[F[_]: ApplicativeThrow](
      config: Config.InitialState,
  ): F[(ProtocolVersion, zswap.NetworkId)] =
    (config match {
      case Config.InitialState.CreateNew(networkId) =>
        (ProtocolVersion.V1, networkId).asRight
      case Config.InitialState.Seed(_, networkId) =>
        (ProtocolVersion.V1, networkId).asRight
      case Config.InitialState.SerializedSnapshot(serialized) =>
        V1Combination.snapshotInstances.parse(serialized).map(s => (s.protocolVersion, s.networkId))
    }).liftTo[F]

  private def buildInitialCombination[F[_]: Async](
      protocolVersion: ProtocolVersion,
      config: Config,
      submissionServiceFactory: SubmissionServiceFactory[F],
      provingServiceFactory: ProvingServiceFactory[F],
      syncServiceFactory: SyncServiceFactory[F],
  )(using zswap.NetworkId, Tracer[F, StructuredLog]): Resource[F, VersionCombination[F]] =
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
