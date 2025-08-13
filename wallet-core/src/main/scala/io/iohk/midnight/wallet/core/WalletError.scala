package io.iohk.midnight.wallet.core

import cats.Show
import cats.syntax.show.*

import scala.scalajs.js.annotation.JSExportAll

sealed trait ReadableMessage {
  def message: String
}

sealed trait ThrowableError extends Exception {
  def toThrowable: Throwable
}

@JSExportAll
sealed trait WalletError extends ThrowableError, ReadableMessage {
  def toString: String
  override def message: String = this.toString
}

@SuppressWarnings(Array("org.wartremover.warts.ToString"))
object WalletError {
  final case class NotSufficientFunds[TokenType: Show](tokenType: TokenType) extends WalletError {
    override def toString: String = s"Insufficient Funds: could not balance ${tokenType.show}"

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

  final case class Composite(errors: Seq[WalletError]) extends WalletError {
    override def toString: String =
      s"Multiple errors occurred: ${errors.map(_.toString).mkString(", ")}"

    override def toThrowable: Throwable = errors.headOption match {
      case Some(err) => new Throwable("Multiple errors occurred", err)
      case None      => new Throwable("Unknown error occurred")
    }

  }

  final case class SerializationError(error: Throwable) extends WalletError {
    override def toString: String = s"SerializationError: ${error.getMessage}"
    override def toThrowable: Throwable = error
  }
}
