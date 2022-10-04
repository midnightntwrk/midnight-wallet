package io.iohk.midnight.wallet.ogmios.sync

import scala.annotation.nowarn
import scala.scalajs.js
import scala.scalajs.js.annotation.*

/** Contains global initialization code that should always be run.
  */
@JSExportTopLevel("Init")
object Init {

  @js.native @JSImport("cross-fetch", JSImport.Namespace)
  @nowarn val crossFetch: js.Dynamic = js.native

  @js.native @JSImport("isomorphic-ws", JSImport.Namespace)
  @nowarn val ws: js.Dynamic = js.native

  /** Updates the `global object` so that websocket related code works in both the browser and
    * NodeJS.
    *
    * See https://nodejs.org/api/globals.html#globals_global for the set fields and
    * https://sttp.softwaremill.com/en/latest/backends/javascript/fetch.html#esmodule for a
    * description of the approach.
    */
  private val g = scalajs.js.Dynamic.global.globalThis
  g.fetch = crossFetch.default
  g.Headers = crossFetch.Headers
  g.Request = crossFetch.Request
  g.WebSocket = ws.default

}
