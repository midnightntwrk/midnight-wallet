package io.iohk.midnight.wallet.blockchain.data

final case class Hash[T](value: String) extends AnyVal {
  def toHexString: String = value
}
