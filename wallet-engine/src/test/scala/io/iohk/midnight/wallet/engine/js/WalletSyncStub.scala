package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.core.Wallet
import scala.scalajs.js
import typings.midnightLedger.mod.*

class WalletSyncStub(txs: Seq[Transaction]) extends Wallet[IO] {
  override def submitTransaction(transaction: Transaction): IO[TransactionIdentifier] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Transaction] =
    Stream.emits(txs)

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())

  override def publicKey(): IO[ZSwapCoinPublicKey] =
    IO.raiseError(new NotImplementedError())
}
class WalletSyncFailingStub(txs: Seq[Transaction], error: Throwable) extends Wallet[IO] {
  override def submitTransaction(transaction: Transaction): IO[TransactionIdentifier] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Transaction] =
    Stream.emits(txs) ++ Stream.raiseError[IO](error)

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())

  override def publicKey(): IO[ZSwapCoinPublicKey] =
    IO.raiseError(new NotImplementedError())
}

class WalletSyncInfiniteStub extends Wallet[IO] {
  override def submitTransaction(transaction: Transaction): IO[TransactionIdentifier] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Transaction] =
    Stream.never[IO]

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())

  override def publicKey(): IO[ZSwapCoinPublicKey] =
    IO.raiseError(new NotImplementedError())
}
