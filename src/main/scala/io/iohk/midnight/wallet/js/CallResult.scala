package io.iohk.midnight.wallet.js

import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}

sealed trait CallResult

@JSExportTopLevel("Succeed")
case class Succeed(@JSExport hash: String) extends CallResult {
  @JSExport val `type`: String = "Succeed"
}
@JSExportTopLevel("Failed")
case class Failed(@JSExport reason: String) extends CallResult {
  @JSExport val `type`: String = "Failed"
}
