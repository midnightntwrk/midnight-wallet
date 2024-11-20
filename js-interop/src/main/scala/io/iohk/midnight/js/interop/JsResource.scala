package io.iohk.midnight.js.interop

import cats.effect.unsafe.implicits.global
import cats.effect.{IO, Resource}

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportTopLevel("JsResourceAllocated")
@JSExportAll
final case class JsResourceAllocated[T](value: T, deallocate: js.Function0[js.Promise[Unit]])

@JSExportTopLevel("JsResourceInstance")
@JSExportAll
final case class JsResource[T](
    alloc: js.Function0[js.Promise[JsResourceAllocated[T]]],
) {
  def allocate(): js.Promise[JsResourceAllocated[T]] = {
    alloc()
  }
}

@JSExportTopLevel("JsResource")
@JSExportAll
object JsResource {
  def make[T](
      alloc: js.Function0[js.Promise[T]],
      dealloc: js.Function1[T, js.Promise[Unit]],
  ): JsResource[T] = {
    JsResource(() => {
      alloc().`then`((value: T) => {
        JsResourceAllocated(value, () => dealloc(value))
      })
    })
  }

  def fromCats[T](catsResource: Resource[IO, T]): JsResource[T] = {
    JsResource(() => {
      catsResource.allocated.unsafeToPromise().`then` { case (value, dealloc) =>
        JsResourceAllocated(value, () => dealloc.unsafeToPromise())
      }
    })
  }
}
