package io.iohk.midnight.wallet.indexer

import scala.scalajs.js
import scala.scalajs.js.annotation.*

/** Contains global initialization code that should always be run.
  */
@JSExportTopLevel("InitWs")
object Init {
  @js.native @JSImport("isomorphic-ws", JSImport.Namespace)
  val ws: js.Dynamic = js.native

  /** Updates the `global object` so that websocket related code works in both the browser and
    * NodeJS.
    *
    * See https://nodejs.org/api/globals.html#globals_global for the set fields and
    * https://sttp.softwaremill.com/en/latest/backends/javascript/fetch.html#esmodule for a
    * description of the approach.
    */
  private val g = scalajs.js.Dynamic.global.globalThis
  g.WebSocket = ws.default

}
