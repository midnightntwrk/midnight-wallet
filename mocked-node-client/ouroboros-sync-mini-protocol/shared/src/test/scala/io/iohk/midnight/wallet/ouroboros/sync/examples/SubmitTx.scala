package io.iohk.midnight.wallet.ouroboros.sync.examples

import io.iohk.midnight.wallet.ouroboros.sync.TestDomain.Transaction
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.Hash

object SubmitTx {

  val validTx: Transaction = Transaction(
    Hash("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"),
  )
}
