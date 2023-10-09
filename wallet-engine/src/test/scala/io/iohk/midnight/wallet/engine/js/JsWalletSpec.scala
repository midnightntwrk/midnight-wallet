package io.iohk.midnight.wallet.engine.js

import cats.effect.kernel.Deferred
import cats.effect.{IO, Ref}
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.rxjs.mod.firstValueFrom
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.zswap.{CoinPublicKey, TokenType}
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF
import scala.concurrent.duration.DurationInt

class JsWalletSpec extends CatsEffectSuite with ScalaCheckEffectSuite with BetterOutputSuite {

  test("balance should return wallet balance") {
    forAllF(Gen.posNum[BigInt]) { (balance: BigInt) =>
      val wallet =
        new JsWallet(
          new WalletTransactionProcessingServiceStub(),
          new WalletStateServiceBalanceStub(balance),
          new WalletTxSubmissionServiceStub(),
          new WalletTransactionServiceStub(),
          IO.unit,
        )
      val observable = wallet.state()
      IO.fromPromise(IO(firstValueFrom(observable)))
        .map(_.balances)
        .map(r => assertEquals(r.get(TokenType.Native), Some(balance.toJsBigInt)))
    }
  }

  test("publicKey should return wallet coin public key") {
    val coinPubKey = CoinPublicKey("test-coinPubKey")
    val encPubKey = "test-encPubKey"
    val wallet =
      new JsWallet(
        new WalletTransactionProcessingServiceStub(),
        new WalletStateServicePubKeyStub(coinPubKey, encPubKey),
        new WalletTxSubmissionServiceStub(),
        new WalletTransactionServiceStub(),
        IO.unit,
      )
    IO.fromPromise(IO(firstValueFrom(wallet.state())))
      .map(state => (state.coinPublicKey, state.encryptionPublicKey))
      .assertEquals((coinPubKey, encPubKey))
  }

  test("should close") {
    for {
      ref <- Ref.of[IO, Boolean](false)
      wallet = new JsWallet(
        new WalletTransactionProcessingServiceStub(),
        new WalletStateServiceStub(),
        new WalletTxSubmissionServiceStub(),
        new WalletTransactionServiceStub(),
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
        new WalletTransactionProcessingServiceStartStub(isFinished),
        new WalletStateServiceStub(),
        new WalletTxSubmissionServiceStub(),
        new WalletTransactionServiceStub(),
        IO.unit,
      )
      _ <- IO(wallet.start())
      result <- isFinished.get.timeout(5.seconds)
    } yield assert(result)
  }
}
