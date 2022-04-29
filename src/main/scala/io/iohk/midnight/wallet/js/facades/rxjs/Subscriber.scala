package io.iohk.midnight.wallet.js.facades.rxjs

import scala.scalajs.js
import scala.scalajs.js.annotation.JSImport

@js.native
@JSImport("rxjs")
class Subscriber[T] extends js.Object with Observer[T]
