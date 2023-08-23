package io.iohk.midnight.wallet.zswap

import cats.MonadThrow
import cats.effect.Sync
import cats.syntax.all.*
import io.iohk.midnight.wallet.jnr.*
import io.iohk.midnight.wallet.jnr.Ledger.{TxAppliedSuccessfully, TxApplyError}
import io.iohk.midnight.wallet.zswap.Wallet.LedgerException

trait Wallet[F[_]] {
  def isRelevant(transaction: Transaction): F[Boolean]

  def apply(transaction: Transaction): F[Wallet[F]]

  def getState: F[WalletLocalState]
}

private final class WalletImpl[F[_]: Sync: MonadThrow](
    ledger: Ledger,
    viewingKey: ViewingKey,
    state: WalletLocalState,
) extends Wallet[F] {

  override def isRelevant(transaction: Transaction): F[Boolean] =
    Sync[F]
      .blocking(ledger.isTransactionRelevant(transaction.asString, viewingKey.asString))
      .flatMap {
        case LedgerSuccess.OperationTrue  => true.pure
        case LedgerSuccess.OperationFalse => false.pure
        case LedgerResult.UnknownCode(code) =>
          LedgerException(s"Unknown code received: $code").raiseError
        case error: LedgerError =>
          LedgerException(s"Ledger error received: $error").raiseError
      }

  override def apply(transaction: Transaction): F[Wallet[F]] =
    ledger
      .applyTransactionToState(transaction.asString, state.asString)
      .flatMap {
        case TxAppliedSuccessfully(updatedState, _) =>
          Right(new WalletImpl(ledger, viewingKey, WalletLocalState(updatedState)))
        case TxApplyError(ledgerError, _) =>
          Left(LedgerException(s"Error applying tx: ${ledgerError.code}"))
      }
      .liftTo[F]

  override def getState: F[WalletLocalState] =
    state.pure
}

object Wallet {
  final case class LedgerException(msg: String) extends IllegalStateException(msg)

  def build[F[_]: Sync](
      ledger: Ledger,
      viewingKey: ViewingKey,
      state: WalletLocalState,
  ): Wallet[F] =
    new WalletImpl[F](ledger, viewingKey, state)
}
