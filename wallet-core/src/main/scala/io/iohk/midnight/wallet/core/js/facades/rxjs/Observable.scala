package io.iohk.midnight.wallet.core.js.facades.rxjs

import scala.annotation.nowarn
import scala.scalajs.js
import scala.scalajs.js.annotation.JSImport

@js.native
@JSImport("rxjs")
class Observable[T] extends js.Object {

  def this(subscribe: js.ThisFunction1[Observable[T], Subscriber[T], js.Function0[Unit]]) = this()

  @nowarn def subscribe(observer: Observer[T]): Subscription = js.native
}
