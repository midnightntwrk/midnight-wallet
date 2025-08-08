package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.midnightNtwrkZswap.mod

import scala.scalajs.js.annotation.{JSExport, JSExportAll, JSExportTopLevel}
import scala.util.Try

@JSExportAll
enum NetworkId(val name: String, val toJs: mod.NetworkId) {
  case Undeployed extends NetworkId("Undeployed", mod.NetworkId.Undeployed)
  case DevNet extends NetworkId("DevNet", mod.NetworkId.DevNet)
  case TestNet extends NetworkId("TestNet", mod.NetworkId.TestNet)
  case MainNet extends NetworkId("MainNet", mod.NetworkId.MainNet)
}

@JSExportTopLevel("NetworkId")
object NetworkId {
  def fromString(str: String): Try[NetworkId] = Try(valueOf(str))
  @JSExport def fromJs(js: mod.NetworkId): NetworkId =
    js match {
      case mod.NetworkId.Undeployed => NetworkId.Undeployed
      case mod.NetworkId.DevNet     => NetworkId.DevNet
      case mod.NetworkId.TestNet    => NetworkId.TestNet
      case mod.NetworkId.MainNet    => NetworkId.MainNet
    }

  @JSExport def toJs(js: NetworkId): mod.NetworkId =
    js match {
      case NetworkId.Undeployed => mod.NetworkId.Undeployed
      case NetworkId.DevNet     => mod.NetworkId.DevNet
      case NetworkId.TestNet    => mod.NetworkId.TestNet
      case NetworkId.MainNet    => mod.NetworkId.MainNet
    }
}
