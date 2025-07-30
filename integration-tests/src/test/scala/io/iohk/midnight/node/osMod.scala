package io.iohk.midnight.node

import scala.scalajs.js
import scala.scalajs.js.annotation.JSImport

/** Generated with Scalably typed from `@types/node` npm package, and then extracted, because full
  * node.js typings fail compilation
  */
object osMod {

  @JSImport("os", JSImport.Namespace)
  @js.native
  val ^ : js.Any = js.native

  /** Returns an estimate of the default amount of parallelism a program should use. Always returns
    * a value greater than zero.
    *
    * This function is a small wrapper about libuv's
    * [`uv_available_parallelism()`](https://docs.libuv.org/en/v1.x/misc.html#c.uv_available_parallelism).
    *
    * @since v19.4.0,
    *   v18.14.0
    */
  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  inline def availableParallelism(): Double =
    ^.asInstanceOf[js.Dynamic].applyDynamic("availableParallelism")().asInstanceOf[Double]
}
