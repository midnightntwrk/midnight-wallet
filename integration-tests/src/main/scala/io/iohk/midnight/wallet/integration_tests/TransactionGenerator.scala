package io.iohk.midnight.wallet.integration_tests

import cats.effect.unsafe.IORuntimeConfig
import cats.effect.{IO, IOApp, Resource}
import cats.syntax.all.*
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset
import io.iohk.midnight.wallet.core
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.Config.InitialState
import io.iohk.midnight.wallet.core.combinator.VersionCombinator
import scala.concurrent.duration.DurationInt
import sttp.client3.UriContext
import scalajs.js

object TransactionGenerator extends IOApp.Simple {

  given networkId: zswap.NetworkId = zswap.NetworkId.Undeployed

  override def runtimeConfig: IORuntimeConfig =
    super.runtimeConfig.copy(cpuStarvationCheckInterval = 5.seconds)

  val indexerRPCUri = uri"http://localhost:8088/api/graphql"
  val indexerWSUri = uri"ws://localhost:8088/api/graphql/ws"
  val proverServerUri = uri"http://localhost:6300"
  val substrateNodeUri = uri"http://localhost:9944"

  type Address = zswap.Address[v1.CoinPublicKey, v1.EncPublicKey]
  type TokenTransfer = domain.TokenTransfer[v1.TokenType]
  type Snapshot = core.Snapshot[v1.LocalState, v1.Transaction]

  def randomRecipient(): Address = {
    val localState = v1.LocalState()
    import zswap.given
    new Address(localState.coinPublicKey, localState.encryptionPublicKey)
  }

  def makeRunningWalletResource(initialState: InitialState): Resource[IO, VersionCombinator[IO]] =
    new WalletBuilder[IO, v1.LocalState, v1.Transaction]
      .build(
        Config(
          indexerRPCUri,
          indexerWSUri,
          proverServerUri,
          substrateNodeUri,
          LogLevel.Info,
          initialState,
          discardTxHistory = true,
        ),
      )
      .flatTap(_.sync.background)

  def withRunningWallet(
      initialWalletState: InitialState,
  )(body: VersionCombinator[IO] => IO[Unit]): IO[Unit] =
    makeRunningWalletResource(initialWalletState).use(body(_))

  def prepareOutputs(coins: List[v1.CoinInfo], recipient: Address): List[TokenTransfer] =
    coins.map { coin =>
      new TokenTransfer(
        coin.value.toScalaBigInt,
        coin.`type`,
        domain.Address(recipient.asString),
      )
    }

  val initialState: InitialState =
    InitialState.Seed("0000000000000000000000000000000000000000000000000000000000000042", networkId)

  override val run: IO[Unit] =
    withRunningWallet(initialState) { v =>
      val initialSync =
        v.state
          .evalTap(s => IO.println(s.syncProgress))
          .find { s =>
            s.syncProgress.synced.isDefined && s.syncProgress.synced === s.syncProgress.total
          }
          .map(_.balances.getOrElse(v1.nativeToken(), BigInt(0)))
          .compile
          .lastOrError

      val prepareTx =
        v.transactionService(ProtocolVersion.V1)
          .flatMap(
            _.prepareTransferRecipe(
              prepareOutputs(
                List(v1.createCoinInfo(v1.nativeToken(), js.BigInt(10_000))),
                randomRecipient(),
              ),
            ),
          )

      val waitConfirmation =
        v.state
          .find(s => s.coins.size === s.availableCoins.size)
          .map(_.balances.getOrElse(v1.nativeToken(), BigInt(0)))
          .compile
          .lastOrError

      val init = for {
        _ <- IO.println("Syncing...")
        balance <- initialSync
        _ <- IO.println(s"Synced. Initial balance: $balance")
      } yield ()

      val sendAndWait = for {
        _ <- IO.println("Preparing txs...")
        numberOfTxs <- v.state.head.map(_ => 1).compile.lastOrError
        txsToProve <- prepareTx.replicateA(numberOfTxs)
        _ <- IO.println(
          s"Proving txs: [${txsToProve.map(_.transaction.identifiers().head).mkString(", ")}]",
        )
        txs <- txsToProve.parTraverse(tx =>
          v.transactionService(ProtocolVersion.V1).flatMap(_.proveTransaction(tx)),
        )
        _ <- IO.println(s"Submitting txs: [${txs.map(_.identifiers().head).mkString(", ")}]")
        _ <- txs.parTraverse(tx =>
          v.submissionService(ProtocolVersion.V1).flatMap(_.submitTransaction(tx)),
        )
        _ <- IO.println("Txs sent. Waiting for confirmation...")
        balance <- waitConfirmation
        _ <- IO.println(s"Confirmed. Balance left: $balance")
      } yield ()

      init >> sendAndWait.foreverM
    }
}
