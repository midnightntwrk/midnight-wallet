package io.iohk.midnight.wallet.js

import scala.scalajs.js.annotation.JSExportTopLevel

sealed trait CallResult

@JSExportTopLevel("Succeed")
case class Succeed(hash: String) extends CallResult
@JSExportTopLevel("Failed")
case class Failed(reason: String) extends CallResult
