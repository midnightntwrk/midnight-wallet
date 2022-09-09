package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.{CallTransaction, DeployTransaction, Hash}
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.core.domain.UserId

class WalletSyncStub(events: Seq[Seq[Any]]) extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Seq[Any]] = Stream.emits(events)

  override def getUserId(): IO[UserId] = IO.raiseError(new NotImplementedError)
}

class WalletSyncFailingStub(events: Seq[Seq[Any]], error: Throwable) extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Seq[Any]] =
    Stream.emits(events) ++ Stream.raiseError[IO](error)

  override def getUserId(): IO[UserId] = IO.raiseError(new NotImplementedError)
}

class WalletSyncInfiniteStub extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Seq[Any]] =
    Stream.iterate(Seq(0))(_.map(_ + 1))

  override def getUserId(): IO[UserId] = IO.raiseError(new NotImplementedError)
}
