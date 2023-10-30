package io.iohk.midnight.wallet.jnr

import scala.util.Try

enum NetworkId(val id: Int) {
  case Undeployed extends NetworkId(0)
  case DevNet extends NetworkId(1)
  case TestNet extends NetworkId(2)
  case MainNet extends NetworkId(3)
}

object NetworkId {
  def fromString(networkIdName: String): Option[NetworkId] =
    Try(NetworkId.valueOf(networkIdName)).toOption
}
