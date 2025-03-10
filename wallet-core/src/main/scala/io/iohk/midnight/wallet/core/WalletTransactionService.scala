package io.iohk.midnight.wallet.core

import cats.effect.{IO, Sync}
import cats.syntax.all.*
import io.iohk.midnight.wallet.core.capabilities.{WalletTxBalancing, WalletTxTransfer}
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.tracing.WalletTxServiceTracer
import io.iohk.midnight.wallet.zswap

trait WalletTransactionService[
    UnprovenTransaction,
    Transaction,
    CoinInfo,
    TokenType,
    CoinPublicKey,
    EncryptionPublicKey,
] {
  def prepareTransferRecipe(
      outputs: List[TokenTransfer[TokenType, CoinPublicKey, EncryptionPublicKey]],
  ): IO[TransactionToProve[UnprovenTransaction]]

  def proveTransaction(
      provingRecipe: ProvingRecipe[UnprovenTransaction, Transaction],
  ): IO[Transaction]

  def balanceTransaction(
      tx: Transaction,
      newCoins: Seq[CoinInfo],
  ): IO[
    (TransactionToProve[UnprovenTransaction] |
      BalanceTransactionToProve[UnprovenTransaction, Transaction] |
      NothingToProve[UnprovenTransaction, Transaction]),
  ]
}

class WalletTransactionServiceFactory[
    TWallet,
    UnprovenTransaction,
    Transaction,
    CoinInfo,
    TokenType,
    CoinPublicKey,
    EncryptionPublicKey,
](using
    WalletTxBalancing[
      TWallet,
      Transaction,
      UnprovenTransaction,
      CoinInfo,
    ],
    WalletTxTransfer[
      TWallet,
      Transaction,
      UnprovenTransaction,
      TokenType,
      CoinPublicKey,
      EncryptionPublicKey,
    ],
    zswap.Transaction.Transaction[Transaction, ?],
    zswap.UnprovenTransaction.IsSerializable[UnprovenTransaction],
) {

  private type Service =
    WalletTransactionService[
      UnprovenTransaction,
      Transaction,
      CoinInfo,
      TokenType,
      CoinPublicKey,
      EncryptionPublicKey,
    ]

  def create(
      walletStateContainer: WalletStateContainer[TWallet],
      provingService: ProvingService[UnprovenTransaction, Transaction],
  )(using
      tracer: WalletTxServiceTracer,
      walletTxTransfer: WalletTxTransfer[
        TWallet,
        Transaction,
        UnprovenTransaction,
        TokenType,
        CoinPublicKey,
        EncryptionPublicKey,
      ],
      walletTxBalancing: WalletTxBalancing[TWallet, Transaction, UnprovenTransaction, CoinInfo],
  ): Service = new Service {
    override def prepareTransferRecipe(
        outputs: List[TokenTransfer[TokenType, CoinPublicKey, EncryptionPublicKey]],
    ): IO[TransactionToProve[UnprovenTransaction]] = {
      val unprovenTransaction: Either[WalletError, UnprovenTransaction] =
        walletTxTransfer.prepareTransferRecipe(outputs)

      unprovenTransaction match
        case Right(unprovenTransactionToBalance) =>
          walletStateContainer
            .modifyStateEither { wallet =>
              walletTxBalancing
                .balanceTransaction(
                  wallet,
                  (Right(unprovenTransactionToBalance), Seq.empty[CoinInfo]),
                )
                .flatMap { case (wallet, recipe) =>
                  recipe.unprovenTransaction match {
                    case Some(unprovenTx) => Right((wallet, TransactionToProve(unprovenTx)))
                    case None             => Left(WalletError.NoTokenTransfers)
                  }
                }
            }
            .flatMap {
              case Left(error) =>
                error.toThrowable.raiseError
              case Right(recipe) => recipe.pure
            }
        case Left(error) =>
          error.toThrowable.raiseError
    }

    override def proveTransaction(
        provingRecipe: ProvingRecipe[UnprovenTransaction, Transaction],
    ): IO[Transaction] = {
      val provenTx: IO[Transaction] = provingRecipe match {
        case TransactionToProve(transaction) =>
          provingService.proveTransaction(transaction)
        case BalanceTransactionToProve(toProve, toBalance) =>
          provingService
            .proveTransaction(toProve)
            .map(provedTx => toBalance.merge(provedTx))
        case NothingToProve(transaction) =>
          transaction.pure
      }

      provenTx.onError { error =>
        provingRecipe.unprovenTransaction match {
          case Some(tx) =>
            walletStateContainer
              .updateStateEither(wallet =>
                walletTxTransfer.applyFailedUnprovenTransaction(wallet, tx),
              )
              .flatMap { _ =>
                val id = tx.identifiers.headOption.map(TransactionIdentifier.apply)
                tracer.unprovenTransactionReverted(id, error)
              }
          case None =>
            Sync[IO].unit
        }
      }
    }

    override def balanceTransaction(
        tx: Transaction,
        newCoins: Seq[CoinInfo],
    ): IO[
      (TransactionToProve[UnprovenTransaction] |
        BalanceTransactionToProve[UnprovenTransaction, Transaction] |
        NothingToProve[UnprovenTransaction, Transaction]),
    ] = {
      walletStateContainer
        .modifyStateEither(wallet =>
          walletTxBalancing.balanceTransaction(wallet, (Left(tx), newCoins)),
        )
        .flatMap {
          case Left(error) =>
            error.toThrowable.raiseError
          case Right(recipe) => recipe.pure
        }
    }
  }
}
