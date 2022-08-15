package io.iohk.midnight.wallet.engine.js

import scala.scalajs.js
import scala.scalajs.js.annotation.*
import scala.annotation.nowarn

/** Contains global initialization code that should always be run.
  */
@JSExportTopLevel("Init")
object Init {

  @js.native @JSImport("node-fetch", JSImport.Namespace)
  @nowarn val nodeFetch: js.Dynamic = js.native

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
  g.fetch = nodeFetch.default
  g.Headers = nodeFetch.Headers
  g.Request = nodeFetch.Request
  g.WebSocket = ws.default

}
