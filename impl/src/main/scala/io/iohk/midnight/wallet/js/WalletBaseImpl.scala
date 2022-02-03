package io.iohk.midnight.wallet.js

import scala.annotation.nowarn
import scala.scalajs.js
import scala.scalajs.js.annotation.JSImport
import typings.api.mod

@nowarn
@js.native
@JSImport("api/dist/wallet.js", "WalletBaseImpl")
class WalletBaseImpl(walletInternal: mod.WalletInternal) extends js.Object
