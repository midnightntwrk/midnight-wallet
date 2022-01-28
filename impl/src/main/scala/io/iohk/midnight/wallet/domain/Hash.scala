package io.iohk.midnight.wallet.domain

case class Hash[T](value: String) extends AnyVal {
  def toHexString: String = value
}
