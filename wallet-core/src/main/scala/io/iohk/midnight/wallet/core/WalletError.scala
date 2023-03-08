package io.iohk.midnight.wallet.core

sealed trait ReadableMessage {
  def message: String
}

sealed trait ThrowableError {
  def toThrowable: Throwable
}

sealed trait WalletError extends ThrowableError

@SuppressWarnings(Array("org.wartremover.warts.ToString"))
object WalletError {

  @SuppressWarnings(Array("org.wartremover.warts.ImplicitConversion"))
  implicit def toReadableMessage(error: WalletError): ReadableMessage = new ReadableMessage {
    override def message: String = error.toString
  }
  final case object NotSufficientFunds extends WalletError {
    override def toString: String = "Not sufficient funds to balance the cost of transaction"

    override def toThrowable: Throwable = new Throwable(this.message)
  }

  final case class BadTransactionFormat(error: Throwable) extends WalletError {
    override def toString: String = s"BadTransactionFormat: ${error.getMessage}"

    override def toThrowable: Throwable = error
  }
}
