package io.iohk.midnight.wallet.engine.js

import cats.effect.kernel.Deferred
import cats.effect.{IO, Ref}
import io.iohk.midnight.js.interop.util.ObservableOps.SubscribeableObservable
import io.iohk.midnight.midnightLedger.mod.{ZSwapCoinPublicKey, Transaction as LedgerTransaction}
import io.iohk.midnight.midnightWalletApi.distTypesFilterMod.Filter
import io.iohk.midnight.rxjs.distTypesInternalTypesMod.Observer
import io.iohk.midnight.rxjs.mod.firstValueFrom
import io.iohk.midnight.wallet.core.Generators.*
import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF.forAllF

import scala.concurrent.duration.DurationInt
import scala.scalajs.js
import scala.scalajs.js.JSConverters.*

trait JsWalletFixtures {
  val jsWalletEmptyTxList: JsWallet =
    new JsWallet(
      new WalletBlockProcessingServiceStub(),
      new WalletStateServiceStub(),
      new WalletFilterServiceStub(Seq.empty),
      new WalletTxSubmissionServiceStub(),
      IO.unit,
    )

  val jsWallet: JsWallet =
    new JsWallet(
      new WalletBlockProcessingServiceStub(),
      new WalletStateServiceStub(),
      new WalletFilterServiceStub(ledgerTransactionsList),
      new WalletTxSubmissionServiceStub(),
      IO.unit,
    )
}

class JsWalletSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with JsWalletFixtures
    with BetterOutputSuite {
  test("connect should return the public key") {
    forAllF(zSwapCoinPublicKeyGen) { (zSwapCoinPublicKey: ZSwapCoinPublicKey) =>
      val wallet =
        new JsWallet(
          new WalletBlockProcessingServiceStub(),
          new WalletStateServicePublicKeyStub(zSwapCoinPublicKey: ZSwapCoinPublicKey),
          new WalletFilterServiceStub(Seq.empty),
          new WalletTxSubmissionServiceStub(),
          IO.unit,
        )
      val observable = wallet.connect()
      IO.fromPromise(IO(firstValueFrom(observable)))
        .map(assertEquals(_, zSwapCoinPublicKey))
    }
  }

  test("submitting a generic tx successfully should return the tx identifier") {
    forAllF(ledgerTransactionGen) { txWithCtx =>
      val TransactionWithContext(tx, _, coins) = txWithCtx
      @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
      val txIdentifier = tx.identifiers().headOption.get

      val wallet =
        new JsWallet(
          new WalletBlockProcessingServiceStub(),
          new WalletStateServiceStub(),
          new WalletFilterServiceStub(Seq.empty),
          new WalletTxSubmissionServiceIdentifierStub(txIdentifier),
          IO.unit,
        )

      val observable = wallet.submitTx(tx, coins.toJSArray)
      IO.fromPromise(IO(firstValueFrom(observable)))
        .map(txId =>
          assertEquals(
            LedgerSerialization.serializeIdentifier(txId),
            LedgerSerialization.serializeIdentifier(txIdentifier),
          ),
        )
    }
  }

  test("install tx filter returns the filtered txs") {
    for {
      acc <- Ref.of[IO, Seq[LedgerTransaction]](Seq.empty)
      isFinished <- Deferred[IO, Unit]
      observable = jsWallet.installTxFilter(Filter(_ => true))
      _ <- IO {
        observable.subscribeWithObserver(new Observer[LedgerTransaction] {
          override def next(tx: LedgerTransaction): Unit =
            acc.update(old => old :+ tx).unsafeRunAndForget()
          override def error(error: Any): Unit = ()
          override def complete(): Unit = isFinished.complete(()).unsafeRunAndForget()
        })
      }
      _ <- isFinished.get
      result <- acc.get
    } yield {
      assertEquals(result.length, ledgerTransactionsList.length)
    }
  }

  test("no txs get filtered with empty blocks") {
    (for {
      acc <- Ref.of[IO, Seq[LedgerTransaction]](Seq.empty)
      isFinished <- Deferred[IO, Unit]
      observable = jsWalletEmptyTxList.installTxFilter(Filter(_ => true))
      _ <- IO {
        observable.subscribeWithObserver(new Observer[LedgerTransaction] {
          override def next(tx: LedgerTransaction): Unit =
            acc.update(old => old :+ tx).unsafeRunAndForget()
          override def error(error: Any): Unit = ()
          override def complete(): Unit = isFinished.complete(()).unsafeRunAndForget()
        })
      }
      _ <- isFinished.get
    } yield {
      assertIO(acc.get, Seq.empty)
    }).flatten
  }

  test("balance should return wallet balance") {
    forAllF(balanceGen) { (balance: js.BigInt) =>
      val wallet =
        new JsWallet(
          new WalletBlockProcessingServiceStub(),
          new WalletStateServiceBalanceStub(Seq(balance)),
          new WalletFilterServiceStub(Seq.empty),
          new WalletTxSubmissionServiceStub(),
          IO.unit,
        )
      val observable = wallet.balance()
      IO.fromPromise(IO(firstValueFrom(observable)))
        .map(assertEquals(_, balance))
    }
  }

  test("should close") {
    for {
      ref <- Ref.of[IO, Boolean](false)
      wallet = new JsWallet(
        new WalletBlockProcessingServiceStub(),
        new WalletStateServiceStub(),
        new WalletFilterServiceStub(Seq.empty),
        new WalletTxSubmissionServiceStub(),
        ref.set(true),
      )
      _ <- IO.fromPromise(IO(wallet.close()))
      result <- ref.get
    } yield assert(result)
  }

  test("wallet should start") {
    for {
      isFinished <- Deferred[IO, Boolean]
      wallet = new JsWallet(
        new WalletBlockProcessingServiceStartStub(isFinished),
        new WalletStateServiceStub(),
        new WalletFilterServiceStub(Seq.empty),
        new WalletTxSubmissionServiceStub(),
        IO.unit,
      )
      _ <- IO(wallet.start())
      result <- isFinished.get.timeout(5.seconds)
    } yield assert(result)
  }
}
