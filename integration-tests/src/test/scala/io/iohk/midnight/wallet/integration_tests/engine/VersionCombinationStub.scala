package io.iohk.midnight.wallet.integration_tests.engine

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.combinator.VersionCombination
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.{
  WalletStateService,
  WalletTransactionService,
  WalletTxSubmissionService,
}

class VersionCombinationStub(
    txService: WalletTransactionService[
      UnprovenTransaction,
      Transaction,
      CoinInfo,
      TokenType,
      CoinPublicKey,
      EncPublicKey,
    ],
    submissionService: WalletTxSubmissionService[Transaction],
) extends VersionCombination {
  override def sync: IO[Unit] = IO.unit

  override def state: Stream[
    IO,
    WalletStateService.State[
      CoinPublicKey,
      EncPublicKey,
      EncryptionSecretKey,
      TokenType,
      QualifiedCoinInfo,
      CoinInfo,
      Nullifier,
      Transaction,
    ],
  ] = Stream.empty

  override def serializeState: IO[WalletStateService.SerializedWalletState] =
    IO.raiseError(Exception("Test stub"))

  override def transactionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTransactionService[
    UnprovenTransaction,
    Transaction,
    CoinInfo,
    TokenType,
    CoinPublicKey,
    EncPublicKey,
  ]] =
    IO.pure(txService)

  override def submissionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTxSubmissionService[Transaction]] =
    IO.pure(submissionService)
}

object VersionCombinationStub {
  def apply(
      provingService: ProvingService[UnprovenTransaction, Transaction],
      transferRecipe: TransactionToProve[UnprovenTransaction],
  ): VersionCombinationStub =
    new VersionCombinationStub(
      new WalletTransactionServiceWithProvingStub(provingService, transferRecipe),
      WalletTxSubmissionServiceStub,
    )
}

class WalletTransactionServiceWithProvingStub(
    provingService: ProvingService[UnprovenTransaction, Transaction],
    transferRecipe: TransactionToProve[UnprovenTransaction],
) extends WalletTransactionService[
      UnprovenTransaction,
      Transaction,
      CoinInfo,
      TokenType,
      CoinPublicKey,
      EncPublicKey,
    ] {
  override def prepareTransferRecipe(
      outputs: Seq[TokenTransfer[TokenType, CoinPublicKey, EncPublicKey]],
  ): IO[TransactionToProve[UnprovenTransaction]] =
    IO.pure(transferRecipe)

  override def proveTransaction(
      provingRecipe: ProvingRecipe[UnprovenTransaction, Transaction],
  ): IO[Transaction] = {
    provingRecipe match
      case TransactionToProve(transaction) =>
        provingService.proveTransaction(transaction)
      case BalanceTransactionToProve(toProve, toBalance) =>
        provingService
          .proveTransaction(toProve)
          .map { provedTx =>
            toBalance.merge(provedTx)
          }
      case NothingToProve(transaction) => IO.pure(transaction)
  }

  override def balanceTransaction(
      tx: Transaction,
      newCoins: Seq[CoinInfo],
  ): IO[
    BalanceTransactionToProve[UnprovenTransaction, Transaction] |
      TransactionToProve[UnprovenTransaction] | NothingToProve[UnprovenTransaction, Transaction],
  ] =
    IO.pure(NothingToProve(tx))
}

object WalletTxSubmissionServiceStub extends WalletTxSubmissionService[Transaction] {
  override def submitTransaction(transaction: Transaction): IO[TransactionIdentifier] =
    transaction
      .identifiers()
      .headOption
      .fold[IO[TransactionIdentifier]](IO.raiseError(new Exception("Invalid tx")))(txId =>
        IO.pure(TransactionIdentifier(txId)),
      )
}
