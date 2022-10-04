package io.iohk.midnight.js.interop.facades.rxjs

import scala.annotation.nowarn
import scala.scalajs.js
import scala.scalajs.js.annotation.JSImport

@js.native
trait OperatorFunction[T, R] extends js.Function1[Observable[T], Observable[R]]

object Operators {
  @js.native
  @JSImport("rxjs")
  @nowarn def map[T, R](
      _project: js.Function2[T, Int, R],
  ): OperatorFunction[T, R] = js.native
}
