package io.iohk.midnight.wallet.prover

import scala.scalajs.js
import scala.scalajs.js.annotation.*

/** Contains global initialization code that should always be run.
  *
  * TODO: Remove when node.js 18.x is not supported anymore (under a new major version)
  */
@JSExportTopLevel("InitNodeFetch")
object Init {

  @js.native
  @JSImport("node-fetch", JSImport.Namespace)
  val nodeFetch: js.Dynamic = js.native

  /** Updates the `global object` so that fetch related code works in both the browser and NodeJS.
    *
    * See https://nodejs.org/api/globals.html#globals_global for the set fields and
    * https://sttp.softwaremill.com/en/latest/backends/javascript/fetch.html#esmodule for a
    * description of the approach.
    * https://github.com/node-fetch/node-fetch?tab=readme-ov-file#providing-global-access
    */
  val g = scalajs.js.Dynamic.global.globalThis

  if (js.isUndefined(g.fetch)) {
    g.fetch = nodeFetch.default
    g.Headers = nodeFetch.Headers
    g.Request = nodeFetch.Request
  }
}
