package io.iohk.midnight.wallet.jnr

sealed abstract class LedgerResult(val code: Int)

object LedgerResult {
  final case class UnknownCode(unknownCode: Int) extends LedgerResult(unknownCode)

  def apply(code: Int): LedgerResult = {
    LedgerError(code) match {
      case Right(error) => error
      case Left(unknownErrorCode) =>
        LedgerSuccess(unknownErrorCode) match {
          case Left(unknownCode) => UnknownCode(unknownCode)
          case Right(success)    => success
        }
    }
  }
}

sealed abstract class LedgerSuccess(code: Int) extends LedgerResult(code)
object LedgerSuccess {
  case object OperationTrue extends LedgerSuccess(0)
  case object OperationFalse extends LedgerSuccess(1)

  def apply(code: Int): Either[Int, LedgerSuccess] = {
    code match {
      case OperationTrue.code  => Right(OperationTrue)
      case OperationFalse.code => Right(OperationFalse)
      case unknownResultCode   => Left(unknownResultCode)
    }
  }
}

sealed abstract class LedgerError(code: Int) extends LedgerResult(code)
object LedgerError {
  case object EncryptionSecretKeyError extends LedgerError(3)
  case object TransactionError extends LedgerError(4)
  case object ExcUnknown extends LedgerError(255)

  def apply(code: Int): Either[Int, LedgerError] = {
    code match {
      case EncryptionSecretKeyError.code => Right(EncryptionSecretKeyError)
      case TransactionError.code         => Right(TransactionError)
      case ExcUnknown.code               => Right(ExcUnknown)
      case unknownResultCode             => Left(unknownResultCode)
    }
  }
}
