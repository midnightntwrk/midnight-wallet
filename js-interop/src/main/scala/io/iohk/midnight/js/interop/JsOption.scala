package io.iohk.midnight.js.interop

import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichOption
import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportTopLevel("JsOption")
@JSExportAll
object JsOption {
  def asResult[R](option: Option[R]): js.UndefOr[R] = option.orUndefined
}
