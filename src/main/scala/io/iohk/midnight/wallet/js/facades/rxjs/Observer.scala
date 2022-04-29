package io.iohk.midnight.wallet.js.facades.rxjs

import scala.scalajs.js

@js.native
trait Observer[T] extends js.Object {
  def next: js.Function1[T, Unit] = js.native
  def error: js.Function1[js.Any, Unit] = js.native
  def complete: js.Function0[Unit] = js.native
}
