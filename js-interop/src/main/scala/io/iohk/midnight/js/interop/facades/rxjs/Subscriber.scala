package io.iohk.midnight.js.interop.facades.rxjs

import scala.scalajs.js
import scala.scalajs.js.annotation.JSImport

@js.native
@JSImport("rxjs")
class Subscriber[T] extends js.Object with Observer[T]
