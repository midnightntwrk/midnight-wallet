package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.core.Wallet

class WalletSyncStub(blocks: Seq[Block]) extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Block] = Stream.emits(blocks)
}
class WalletSyncFailingStub(blocks: Seq[Block], error: Throwable) extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Block] =
    Stream.emits(blocks) ++ Stream.raiseError[IO](error)

}

class WalletSyncInfiniteStub extends Wallet[IO] {
  override def callContract(contractInput: Wallet.CallContractInput): IO[Hash[CallTransaction]] =
    IO.raiseError(new NotImplementedError)

  override def deployContract(
      contractInput: Wallet.DeployContractInput,
  ): IO[Hash[DeployTransaction]] = IO.raiseError(new NotImplementedError)

  override def sync(): Stream[IO, Block] =
    Stream.never[IO]
}
