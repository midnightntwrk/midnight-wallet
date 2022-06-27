package io.iohk.midnight.wallet.js

import cats.effect.IO
import io.iohk.midnight.wallet.Wallet
import io.iohk.midnight.wallet.domain.{
  CallTransaction,
  DeployTransaction,
  Hash,
  SemanticEvent,
  UserId,
}

class WalletSyncStub(events: Seq[Seq[SemanticEvent]]) extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): fs2.Stream[IO, Seq[SemanticEvent]] = fs2.Stream.emits(events)

  override def getUserId(): IO[UserId] = IO.raiseError(new NotImplementedError)
}

class WalletSyncFailingStub(events: Seq[Seq[SemanticEvent]], error: Throwable) extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): fs2.Stream[IO, Seq[SemanticEvent]] =
    fs2.Stream.emits(events) ++ fs2.Stream.raiseError[IO](error)

  override def getUserId(): IO[UserId] = IO.raiseError(new NotImplementedError)
}

class WalletSyncInfiniteStub extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): fs2.Stream[IO, Seq[SemanticEvent]] =
    fs2.Stream.iterateEval(Seq(SemanticEvent(0)))(events =>
      IO(events.map(event => SemanticEvent(event.value.asInstanceOf[Int] + 1))),
    )

  override def getUserId(): IO[UserId] = IO.raiseError(new NotImplementedError)
}
