package io.iohk.midnight.js.interop.rxjs

import typings.rxjs.distTypesInternalObservableMod.Observable as rxjsObservable
import typings.rxjs.distTypesInternalSubscriberMod.Subscriber
import typings.rxjs.distTypesInternalTypesMod.TeardownLogic
import typings.rxjs.mod
import typings.rxjs.mod.Observable_

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
}
