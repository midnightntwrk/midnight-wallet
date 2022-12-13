package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.wallet.core.{WalletFilterService, WalletState, WalletTxSubmission}

import scala.scalajs.js

class WalletFilterServiceStub(txs: Seq[Transaction]) extends WalletFilterService[IO] {
  override def installTransactionFilter(filter: Transaction => Boolean): Stream[IO, Transaction] =
    Stream.emits(txs)
}
class WalletFilterServiceFailingStub(txs: Seq[Transaction], error: Throwable)
    extends WalletFilterService[IO] {
  override def installTransactionFilter(filter: Transaction => Boolean): Stream[IO, Transaction] =
    Stream.emits(txs) ++ Stream.raiseError[IO](error)
}

class WalletFilterServiceInfiniteStub extends WalletFilterService[IO] {
  override def installTransactionFilter(filter: Transaction => Boolean): Stream[IO, Transaction] =
    Stream.never[IO]
}

class WalletStateStub extends WalletState[IO] {
  private val state = new ZSwapLocalState()
  override def start: IO[Unit] = IO.unit
  override def publicKey: IO[ZSwapCoinPublicKey] = IO.pure(state.coinPublicKey)
  override def balance: Stream[IO, js.BigInt] = Stream.emit(js.BigInt(0))
  override def localState: IO[ZSwapLocalState] = IO.pure(state)
  override def updateLocalState(newState: ZSwapLocalState): IO[Unit] = IO.unit
}

class WalletStatePublicKeyStub(zSwapCoinPublicKey: ZSwapCoinPublicKey) extends WalletState[IO] {
  override def start: IO[Unit] = IO.unit
  override def publicKey: IO[ZSwapCoinPublicKey] = IO.pure(zSwapCoinPublicKey)
  override def balance: Stream[IO, js.BigInt] = Stream.emit(js.BigInt(0))
  override def localState: IO[ZSwapLocalState] = IO.raiseError(new NotImplementedError())
  override def updateLocalState(newState: ZSwapLocalState): IO[Unit] = IO.unit
}

class WalletStateBalanceStub(balance: Seq[js.BigInt]) extends WalletState[IO] {
  override def start: IO[Unit] = IO.unit
  override def publicKey: IO[ZSwapCoinPublicKey] = IO.raiseError(new NotImplementedError())
  override def balance: Stream[IO, js.BigInt] = Stream.emits(balance)
  override def localState: IO[ZSwapLocalState] = IO.raiseError(new NotImplementedError())
  override def updateLocalState(newState: ZSwapLocalState): IO[Unit] = IO.unit
}

class WalletTxSubmissionStub extends WalletTxSubmission[IO] {
  override def submitTransaction(
      transaction: Transaction,
      newCoins: List[CoinInfo],
  ): IO[TransactionIdentifier] =
    transaction
      .identifiers()
      .headOption
      .fold[IO[TransactionIdentifier]](IO.raiseError(new Exception("Invalid tx")))(IO.pure)
}

class WalletTxSubmissionIdentifierStub(txIdentifier: TransactionIdentifier)
    extends WalletTxSubmission[IO] {
  override def submitTransaction(
      transaction: Transaction,
      newCoins: List[CoinInfo],
  ): IO[TransactionIdentifier] =
    IO.pure(txIdentifier)
}
