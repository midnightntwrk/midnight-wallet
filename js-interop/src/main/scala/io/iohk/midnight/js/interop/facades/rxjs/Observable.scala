package io.iohk.midnight.js.interop.facades.rxjs

import scala.annotation.nowarn
import scala.scalajs.js
import scala.scalajs.js.Promise
import scala.scalajs.js.annotation.JSImport

@js.native
@JSImport("rxjs")
class Observable[T] extends js.Object {

  def this(_subscribe: js.ThisFunction1[Observable[T], Subscriber[T], js.Function0[Unit]]) = this()

  @nowarn def subscribe(_observer: Observer[T]): Subscription = js.native

  @nowarn def pipe[A](_op1: OperatorFunction[T, A]): Observable[A] = js.native
}

object Observable {
  @js.native
  @JSImport("rxjs", "from")
  @nowarn def from[T](promise: Promise[T]): Observable[T] = js.native

  @js.native
  @JSImport("rxjs", "firstValueFrom")
  @nowarn def firstValueFrom[T](observable: Observable[T]): Promise[T] = js.native
}
