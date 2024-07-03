package io.iohk.midnight.wallet.core

import cats.syntax.show.*
import io.iohk.midnight.wallet.zswap.TokenType

sealed trait ReadableMessage {
  def message: String
}

sealed trait ThrowableError extends Exception {
  def toThrowable: Throwable
}

sealed trait WalletError extends ThrowableError

@SuppressWarnings(Array("org.wartremover.warts.ToString"))
object WalletError {

  @SuppressWarnings(Array("org.wartremover.warts.ImplicitConversion"))
  implicit def toReadableMessage(error: WalletError): ReadableMessage = new ReadableMessage {
    override def message: String = error.toString
  }
  final case class NotSufficientFunds(tokenType: TokenType) extends WalletError {
    override def toString: String = s"Not sufficient funds to balance token: ${tokenType.show}"

    override def toThrowable: Throwable = new Throwable(this.message)
  }

  case object NoTokenTransfers extends WalletError {
    override def toString: String =
      "List of token transfers is empty or there is no positive transfers"

    override def toThrowable: Throwable = new Throwable(this.message)
  }

  final case class BadTransactionFormat(error: Throwable) extends WalletError {
    override def toString: String = s"BadTransactionFormat: ${error.getMessage}"

    override def toThrowable: Throwable = error
  }

  final case class LedgerExecutionError(error: Throwable) extends WalletError {
    override def toString: String = s"LedgerExecutionError: ${error.getMessage}"
    override def toThrowable: Throwable = error
  }

  final case class InvalidAddress(error: Throwable) extends WalletError {
    override def toString: String = s"InvalidAddressError: ${error.getMessage}"
    override def toThrowable: Throwable = error
  }
}
