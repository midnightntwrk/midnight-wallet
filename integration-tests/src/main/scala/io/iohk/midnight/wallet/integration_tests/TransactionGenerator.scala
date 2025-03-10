package io.iohk.midnight.wallet.integration_tests

import cats.effect.unsafe.IORuntimeConfig
import cats.effect.{IO, IOApp, Resource}
import cats.syntax.all.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.Config.InitialState
import io.iohk.midnight.wallet.core.combinator.VersionCombinator
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.{core, zswap}
import sttp.client3.UriContext
import scala.concurrent.duration.DurationInt
import scala.scalajs.js

object TransactionGenerator extends IOApp.Simple {

  given networkId: zswap.NetworkId = zswap.NetworkId.Undeployed

  override def runtimeConfig: IORuntimeConfig =
    super.runtimeConfig.copy(cpuStarvationCheckInterval = 5.seconds)

  val indexerRPCUri = uri"http://localhost:8088/api/graphql"
  val indexerWSUri = uri"ws://localhost:8088/api/graphql/ws"
  val proverServerUri = uri"http://localhost:6300"
  val substrateNodeUri = uri"http://localhost:9944"

  type Address = domain.Address[v1.CoinPublicKey, v1.EncPublicKey]
  type TokenTransfer = domain.TokenTransfer[v1.TokenType, v1.CoinPublicKey, v1.EncPublicKey]
  type Snapshot = core.Snapshot[v1.LocalStateNoKeys, v1.Transaction]

  def randomRecipient(): Address = {
    val secretKeys = KeyGenerator.randomSecretKeys()
    new Address(secretKeys.coinPublicKey, secretKeys.encryptionPublicKey)
  }

  def makeRunningWalletResource(
      initialState: InitialState,
      seed: Array[Byte],
  ): Resource[IO, VersionCombinator] =
    new WalletBuilder[v1.LocalStateNoKeys, v1.Transaction]
      .build(
        Config(
          indexerRPCUri,
          indexerWSUri,
          proverServerUri,
          substrateNodeUri,
          LogLevel.Info,
          seed,
          initialState,
          discardTxHistory = true,
        ),
      )
      .flatTap(_.sync.background)

  def withRunningWallet(
      initialWalletState: InitialState,
      seed: Array[Byte],
  )(body: VersionCombinator => IO[Unit]): IO[Unit] =
    makeRunningWalletResource(initialWalletState, seed).use(body(_))

  def prepareOutputs(coins: List[v1.CoinInfo], recipient: Address): List[TokenTransfer] =
    coins.map { coin => new TokenTransfer(coin.value.toScalaBigInt, coin.`type`, recipient) }

  val initialState: InitialState =
    InitialState.CreateNew(networkId)

  @SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
  val seed: Array[Byte] =
    zswap.HexUtil.decodeHex("0000000000000000000000000000000000000000000000000000000000000002").get

  override val run: IO[Unit] =
    withRunningWallet(initialState, seed) { v =>
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
