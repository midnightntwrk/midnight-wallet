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
  case object StateError extends LedgerError(5)
  case object ZswapChainStateNewError extends LedgerError(6)
  case object ZswapChainStateFirstFreeError extends LedgerError(7)
  case object ExtractGuaranteedCoinsFromTxError extends LedgerError(8)
  case object ZswapChainStateTryApplyStateError extends LedgerError(9)
  case object ZswapChainStateTryApplyOfferError extends LedgerError(10)
  case object ZswapChainStateTryApplyUpdateStateError extends LedgerError(11)
  case object MerkleTreeCollapsedUpdateNewError extends LedgerError(12)
  case object UnknownNetworkIdError extends LedgerError(13)
  case object ExtractFallibleCoinsFromTxError extends LedgerError(14)
  case object ExcUnknown extends LedgerError(255)

  def apply(code: Int): Either[Int, LedgerError] = {
    code match {
      case EncryptionSecretKeyError.code          => Right(EncryptionSecretKeyError)
      case TransactionError.code                  => Right(TransactionError)
      case StateError.code                        => Right(StateError)
      case ZswapChainStateNewError.code           => Right(ZswapChainStateNewError)
      case ZswapChainStateFirstFreeError.code     => Right(ZswapChainStateFirstFreeError)
      case ExtractGuaranteedCoinsFromTxError.code => Right(ExtractGuaranteedCoinsFromTxError)
      case ZswapChainStateTryApplyStateError.code => Right(ZswapChainStateTryApplyStateError)
      case ZswapChainStateTryApplyOfferError.code => Right(ZswapChainStateTryApplyOfferError)
      case ZswapChainStateTryApplyUpdateStateError.code =>
        Right(ZswapChainStateTryApplyUpdateStateError)
      case MerkleTreeCollapsedUpdateNewError.code => Right(MerkleTreeCollapsedUpdateNewError)
      case UnknownNetworkIdError.code             => Right(UnknownNetworkIdError)
      case ExtractFallibleCoinsFromTxError.code   => Right(ExtractFallibleCoinsFromTxError)
      case ExcUnknown.code                        => Right(ExcUnknown)
      case unknownResultCode                      => Left(unknownResultCode)
    }
  }
}
