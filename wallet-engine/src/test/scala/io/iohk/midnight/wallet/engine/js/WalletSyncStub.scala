package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.core.Wallet
import scala.scalajs.js

class WalletSyncStub(blocks: Seq[Block]) extends Wallet[IO] {
  override def submitTransaction(transaction: Transaction): IO[Hash[Transaction]] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Block] = Stream.emits(blocks)

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())
}
class WalletSyncFailingStub(blocks: Seq[Block], error: Throwable) extends Wallet[IO] {
  override def submitTransaction(transaction: Transaction): IO[Hash[Transaction]] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Block] =
    Stream.emits(blocks) ++ Stream.raiseError[IO](error)

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())
}

class WalletSyncInfiniteStub extends Wallet[IO] {
  override def submitTransaction(transaction: Transaction): IO[Hash[Transaction]] =
    IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Block] =
    Stream.never[IO]

  override def balance(): Stream[IO, js.BigInt] =
    Stream.raiseError[IO](new NotImplementedError())
}
