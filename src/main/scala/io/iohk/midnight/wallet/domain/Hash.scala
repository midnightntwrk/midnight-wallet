package io.iohk.midnight.wallet.domain

final case class Hash[T](value: String) extends AnyVal {
  def toHexString: String = value
}
