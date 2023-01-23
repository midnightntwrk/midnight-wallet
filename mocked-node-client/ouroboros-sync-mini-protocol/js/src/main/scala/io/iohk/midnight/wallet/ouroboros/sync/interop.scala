package io.iohk.midnight.wallet.ouroboros.sync

import scala.annotation.nowarn
import scala.scalajs.js
import scala.scalajs.js.annotation.JSGlobal

object interop {

  @js.native
  trait Decoder[T] extends js.Object {
    @nowarn def decode(raw: String): DecodingResult[T] = js.native
  }

  @js.native
  trait Show[T] extends js.Object {
    @nowarn def show(t: T): String = js.native
  }

  @js.native
  sealed trait DecodingResult[T] extends js.Object

  @js.native
  @JSGlobal
  final class Success[T](val value: T) extends DecodingResult[T]

  @js.native
  @JSGlobal
  final class Failure(val message: String) extends DecodingResult[Nothing]
}
