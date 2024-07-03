package io.iohk.midnight.wallet.integration_tests

import cats.effect.unsafe.IORuntimeConfig
import cats.effect.{IO, IOApp, Resource}
import cats.syntax.all.*
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.blockchain.data.Transaction.Offset
import io.iohk.midnight.wallet.core.Wallet.Snapshot
import io.iohk.midnight.wallet.core.{Wallet, domain}
import io.iohk.midnight.wallet.engine.WalletBuilder
import io.iohk.midnight.wallet.engine.WalletBuilder.WalletDependencies
import io.iohk.midnight.wallet.engine.config.Config
import io.iohk.midnight.wallet.zswap.*
import scala.concurrent.duration.DurationInt
import sttp.client3.UriContext

object TransactionGenerator extends IOApp.Simple {

  override def runtimeConfig: IORuntimeConfig =
    super.runtimeConfig.copy(cpuStarvationCheckInterval = 5.seconds)

  val indexerRPCUri = uri"http://localhost:8088/api/graphql"
  val indexerWSUri = uri"ws://localhost:8088/api/graphql/ws"
  val proverServerUri = uri"http://localhost:6300"
  val substrateNodeUri = uri"http://localhost:9933"

  def randomRecipient(): Address = {
    val localState = LocalState()
    Address(localState.coinPublicKey, localState.encryptionPublicKey)
  }

  def makeRunningWalletResource(
      initialState: Snapshot,
  ): Resource[IO, WalletDependencies[IO]] =
    WalletBuilder
      .build[IO](
        Config(
          indexerRPCUri,
          indexerWSUri,
          proverServerUri,
          substrateNodeUri,
          LogLevel.Info,
          initialState,
        ),
      )
      .evalTap(_.versionCombinator.sync)

  def withRunningWallet(
      initialWalletState: Snapshot,
  )(body: WalletDependencies[IO] => IO[Unit]): IO[Unit] =
    makeRunningWalletResource(initialWalletState)
      .use(body(_))

  def prepareOutputs(coins: List[CoinInfo], recipient: Address): List[domain.TokenTransfer] =
    coins.map { coin =>
      domain.TokenTransfer(coin.value, coin.tokenType, domain.Address(recipient.asString))
    }

  @SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
  val initialState: Snapshot =
    Snapshot.fromSeed("0000000000000000000000000000000000000000000000000000000000000042").toTry.get

  override val run: IO[Unit] =
    withRunningWallet(initialState) { case WalletDependencies(v, submissionService, txService) =>
      val initialSync =
        v.state
          .find { s =>
            s.syncProgress.synced.isDefined && s.syncProgress.synced === s.syncProgress.total
          }
          .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
          .compile
          .lastOrError

      val prepareTx =
        txService.prepareTransferRecipe(
          prepareOutputs(List(CoinInfo(TokenType.Native, BigInt(100_000))), randomRecipient()),
        )

      val waitConfirmation =
        v.state
          .find(s => s.coins.size === s.availableCoins.size)
          .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
          .compile
          .lastOrError

      val init = for {
        _ <- IO.println("Syncing...")
        balance <- initialSync
        _ <- IO.println(s"Synced. Initial balance: $balance")
      } yield ()

      val sendAndWait = for {
        _ <- IO.println("Preparing txs...")
        numberOfTxs <- v.state.head.map(_.availableCoins.size).compile.lastOrError
        txsToProve <- prepareTx.replicateA(numberOfTxs)
        _ <- IO.println(
          s"Proving txs: [${txsToProve.map(_.transaction.identifiers.head).mkString(", ")}]",
        )
        txs <- txsToProve.parTraverse(txService.proveTransaction)
        _ <- IO.println(s"Submitting txs: [${txs.map(_.identifiers.head).mkString(", ")}]")
        _ <- txs.parTraverse(submissionService.submitTransaction)
        _ <- IO.println("Txs sent. Waiting for confirmation...")
        balance <- waitConfirmation
        _ <- IO.println(s"Confirmed. Balance left: $balance")
      } yield ()

      init >> sendAndWait.foreverM
    }
}
