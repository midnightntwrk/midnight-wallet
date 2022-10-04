package io.iohk.midnight.js.interop.facades.rxjs

import scala.annotation.nowarn
import scala.scalajs.js

@js.native
trait Observer[T] extends js.Object {
  @nowarn def next(_value: T): Unit = js.native
  @nowarn def error(_error: js.Any): Unit = js.native
  def complete(): Unit = js.native
}
