package io.iohk.midnight.js.interop

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportTopLevel("JsEither")
@JSExportAll
object JsEither {
  def fold[A, B, R](
      either: Either[A, B],
      onLeft: js.Function1[A, R],
      onRight: js.Function1[B, R],
  ): R =
    either.fold(onLeft, onRight)
}
