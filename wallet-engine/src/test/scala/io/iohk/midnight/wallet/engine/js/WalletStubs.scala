package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.core.{WalletFilterService, WalletState, WalletTxSubmission}
import scala.scalajs.js
import typings.midnightLedger.mod.*

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
  override def start(): IO[Unit] = IO.unit
  override def publicKey(): IO[ZSwapCoinPublicKey] = IO.pure(state.coinPublicKey)
  override def balance(): Stream[IO, js.BigInt] = Stream.emit(js.BigInt(0))

  override def localState(): IO[ZSwapLocalState] = IO.pure(state)

  override def updateLocalState(newState: ZSwapLocalState): IO[Unit] = IO.unit
}

class WalletTxSubmissionStub extends WalletTxSubmission[IO] {
  override def submitTransaction(
      transaction: Transaction,
  ): IO[TransactionIdentifier] =
    transaction
      .identifiers()
      .headOption
      .fold[IO[TransactionIdentifier]](IO.raiseError(new Exception("Invalid tx")))(IO.pure)
}
