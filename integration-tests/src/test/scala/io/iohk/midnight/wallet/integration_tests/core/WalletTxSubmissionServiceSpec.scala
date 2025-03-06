package io.iohk.midnight.wallet.integration_tests.core

import cats.data.NonEmptyList
import cats.effect.IO
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.Generators.{*, given}
import io.iohk.midnight.wallet.core.{
  Generators,
  Snapshot,
  SnapshotInstances,
  WalletInstances,
  WalletStateContainer,
  WalletTransactionServiceFactory,
  WalletTxSubmissionService,
  WalletTxSubmissionServiceFactory,
  domain,
  Wallet as CoreWallet,
}
import io.iohk.midnight.wallet.core.services.*
import io.iohk.midnight.wallet.core.tracing.{WalletTxServiceTracer, WalletTxSubmissionTracer}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.given
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF

import scala.concurrent.duration.DurationInt
import scalajs.js

@SuppressWarnings(Array("org.wartremover.warts.IterableOps", "org.wartremover.warts.TryPartial"))
class WalletTxSubmissionServiceSpec extends WithProvingServerSuite {

  val noOpTracer: Tracer[IO, StructuredLog] = Tracer.noOpTracer[IO]

  given walletTxSubmissionTracer: WalletTxSubmissionTracer = {
    WalletTxSubmissionTracer.from(noOpTracer)
  }
  given networkId: zswap.NetworkId = zswap.NetworkId.Undeployed

  private val txSubmissionService = new TxSubmissionServiceStub()
  private val failingTxSubmissionService = new FailingTxSubmissionServiceStub()

  private given snapshots: SnapshotInstances[LocalStateNoKeys, Transaction] = new SnapshotInstances
  private val wallets: WalletInstances[
    LocalStateNoKeys,
    SecretKeys,
    Transaction,
    TokenType,
    Offer,
    ProofErasedTransaction,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    CoinPublicKey,
    EncryptionSecretKey,
    EncPublicKey,
    CoinSecretKey,
    UnprovenInput,
    ProofErasedOffer,
    MerkleTreeCollapsedUpdate,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenOutput,
  ] = new WalletInstances

  import wallets.given

  type Wallet = CoreWallet[LocalStateNoKeys, SecretKeys, Transaction]

  private val txSubmissionServiceFactory =
    new WalletTxSubmissionServiceFactory[Wallet, Transaction]

  def buildWalletTxSubmissionService(
      initialState: LocalStateNoKeys = LocalStateNoKeys(),
      seed: Option[String] = None,
      txSubmissionService: TxSubmissionService[Transaction] = txSubmissionService,
  ): IO[(WalletTxSubmissionService[Transaction], WalletStateContainer[Wallet])] = {
    val hexSeed = seed.getOrElse(zswap.HexUtil.randomHex())
    val byteSeed = zswap.HexUtil.decodeHex(hexSeed).get
    val snapshot = Snapshot[LocalStateNoKeys, Transaction](
      initialState,
      Seq.empty,
      None,
      ProtocolVersion.V1,
      networkId,
    )
    Bloc[Wallet](walletCreation.create(byteSeed, snapshot)).allocated.map(_._1).map { bloc =>
      val walletStateContainer = new WalletStateContainer.Live(bloc)
      val service =
        txSubmissionServiceFactory
          .create(txSubmissionService, walletStateContainer)
      (service, walletStateContainer)
    }
  }

  test("The first transaction identifier is returned") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, _, _) = txWithCtx
        service <- buildWalletTxSubmissionService().map(_._1)
        txId <- service.submitTransaction(tx)
      } yield assertEquals(txId.txId, tx.identifiers().head)
    }
  }

  test("Transactions get submitted to the client") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, _, _) = txWithCtx
        service <- buildWalletTxSubmissionService().map(_._1)
        _ <- service.submitTransaction(tx)
      } yield assert(txSubmissionService.wasTxSubmitted(tx))
    }
  }

  // Fix me: This can be brought back once we have a proper wellFormed function again
  test("Fails when received transaction is not well formed".ignore) {
    val secretKeys = Generators.keyGenerator()
    forAllF(coinInfoArbitrary.arbitrary, Gen.posNum[Int]) { (coin, amount) =>
      val output =
        UnprovenOutput.`new`(coin, secretKeys.coinPublicKey, secretKeys.encryptionPublicKey)
      // offer with output, but with not the same amount of coins in deltas
      val offer = UnprovenOffer.fromOutput(output, coin.tokenType, coin.value - js.BigInt(amount))

      val invalidTxIO = provingService.proveTransaction(UnprovenTransaction(offer))

      invalidTxIO.flatMap { invalidTx =>
        buildWalletTxSubmissionService()
          .map(_._1)
          .flatMap(
            _.submitTransaction(invalidTx)
              .intercept[txSubmissionServiceFactory.TransactionNotWellFormed] >> IO.unit,
          )
      }
    }
  }

  test("Fails when submission fails") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, _, _) = txWithCtx
        service <- buildWalletTxSubmissionService(txSubmissionService = failingTxSubmissionService)
          .map(_._1)
        result <- service.submitTransaction(tx).attempt
      } yield {
        assertEquals(
          result,
          Left(
            txSubmissionServiceFactory.TransactionSubmissionFailed(
              FailingTxSubmissionServiceStub.TxSubmissionServiceError,
            ),
          ),
        )
      }
    }
  }

  test("Recovers funds when submission is rejected") {
    given WalletTxServiceTracer = WalletTxServiceTracer.from(Tracer.noOpTracer)
    val randomRecipient = {
      val randomSecretKeys = Generators.keyGenerator()
      domain.Address(
        zswap
          .Address[CoinPublicKey, EncPublicKey](
            randomSecretKeys.coinPublicKey,
            randomSecretKeys.encryptionPublicKey,
          )
          .asString,
      )
    }
    for {
      seed <- IO(zswap.HexUtil.randomHex())
      initialStateWithKeys <- IO {
        generateStateWithFunds(
          NonEmptyList.one((nativeToken(), 1_000_000)),
          Some(seed),
        )
      }
      tuple <- buildWalletTxSubmissionService(
        initialState = initialStateWithKeys._1,
        seed = Some(seed),
        txSubmissionService = new RejectedTxSubmissionServiceStub(),
      )
      (service, stateContainer) = tuple
      fiber <- stateContainer.subscribe.take(3).compile.toList.start
      _ <- IO.sleep(1.second)
      txService = new WalletTransactionServiceFactory[
        Wallet,
        UnprovenTransaction,
        Transaction,
        CoinInfo,
        TokenType,
      ].create(stateContainer, provingService)
      unProvenTx <- txService.prepareTransferRecipe(
        List(domain.TokenTransfer(50000, nativeToken(), randomRecipient)),
      )
      tx <- txService.proveTransaction(unProvenTx)
      _ <- service.submitTransaction(tx).attempt
      stateUpdates <- fiber.joinWithNever
    } yield {
      val balances = stateUpdates.flatMap(walletBalances.balance(_).get(nativeToken()))
      val availableCoins = stateUpdates.map(walletCoins.availableCoins)
      assertEquals(balances.headOption, balances.lastOption)
      assert(availableCoins.head.sizeIs == availableCoins.last.size)
      assertEquals(availableCoins.head.map(_.nonce), availableCoins.last.map(_.nonce))
    }
  }

  test("Fails when submission is rejected") {
    forAllF { (txWithCtxIO: IO[TransactionWithContext]) =>
      for {
        txWithCtx <- txWithCtxIO
        TransactionWithContext(tx, _, _, _) = txWithCtx
        service <- buildWalletTxSubmissionService(txSubmissionService =
          new RejectedTxSubmissionServiceStub(),
        ).map(_._1)
        result <- service.submitTransaction(tx).attempt
      } yield assertEquals(
        result,
        Left(
          txSubmissionServiceFactory.TransactionRejected(RejectedTxSubmissionServiceStub.errorMsg),
        ),
      )
    }
  }
}
