package io.iohk.midnight.wallet.blockchain.data

import cats.Show

final case class Hash[T](value: String) extends AnyVal {
  def toHexString: String = value
}

object Hash {
  implicit def hashShow[T]: Show[Hash[T]] = Show.show[Hash[T]](_.toHexString)
}
