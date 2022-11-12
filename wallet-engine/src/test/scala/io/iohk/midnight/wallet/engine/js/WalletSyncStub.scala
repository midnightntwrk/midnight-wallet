package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.core.Wallet
import scala.scalajs.js
import typings.midnightLedger.mod.{
  Transaction as LedgerTransaction,
  TransactionHash as LedgerTransactionHash,
}

class WalletSyncStub(txs: Seq[LedgerTransaction]) extends Wallet[IO] {
  override def submitTransaction(transaction: LedgerTransaction): IO[LedgerTransactionHash] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, LedgerTransaction] =
    Stream.emits(txs)

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())
}
class WalletSyncFailingStub(txs: Seq[LedgerTransaction], error: Throwable) extends Wallet[IO] {
  override def submitTransaction(transaction: LedgerTransaction): IO[LedgerTransactionHash] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, LedgerTransaction] =
    Stream.emits(txs) ++ Stream.raiseError[IO](error)

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())
}

class WalletSyncInfiniteStub extends Wallet[IO] {
  override def submitTransaction(transaction: LedgerTransaction): IO[LedgerTransactionHash] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, LedgerTransaction] =
    Stream.never[IO]

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())
}
