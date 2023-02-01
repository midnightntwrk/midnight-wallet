package io.iohk.midnight.js.interop.rxjs

import io.iohk.midnight.rxjs.distTypesInternalObservableMod.Observable as rxjsObservable
import io.iohk.midnight.rxjs.distTypesInternalSubscriberMod.Subscriber
import io.iohk.midnight.rxjs.distTypesInternalTypesMod.TeardownLogic
import io.iohk.midnight.rxjs.mod
import io.iohk.midnight.rxjs.mod.Observable_

import scala.scalajs.js
import scala.scalajs.js.Promise
import scala.scalajs.js.ThisFunction.fromFunction2

object Observable {
  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  def apply[T](_subscribe: Subscriber[T] => js.Function0[Unit]): Observable_[T] =
    new Observable_[T](
      fromFunction2[rxjsObservable[T], Subscriber[T], TeardownLogic]((_, subscriber) => {
        _subscribe(subscriber).asInstanceOf[TeardownLogic]
      }),
    )

  def firstValueFrom[T](observable: Observable_[T]): Promise[T] = mod.firstValueFrom(observable)
  def lastValueFrom[T](observable: Observable_[T]): Promise[T] = mod.lastValueFrom(observable)
}
