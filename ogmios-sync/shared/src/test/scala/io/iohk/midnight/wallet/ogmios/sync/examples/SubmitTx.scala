package io.iohk.midnight.wallet.ogmios.sync.examples

import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.*

object SubmitTx {

  val validTx: Transaction =
    data.Transaction(
      data.Transaction.Header(
        Hash[Transaction]("3b5b0fae80579c039ff3159a76ad01dc166fe8ffede5dd01013306065d2905c1"),
      ),
      "AAAAAAAAAAABAAAAAAAAAK1fO8BDG0HYZbfUkuiEjz2k630npbZZ47gZqSUrDtQRqoTVkm1WK1Yja7FFiCQEDQPCS68y5H3I3q41wekIqXIAAGpQiCTWB/v7rFagM2nHzJ5G40UHtumN44qn9dFvUUETha0hiYs+lm/eiHBz+Xp+gBbDyuukPL24Ys3J/9+BodBLTYgGfbmvv2EZ32Dv3s8LRlHjhjktWctTkOGxWACcAqvLUwkqLg6iW69eDpQ0RxhaFZ7BpCQ6iVa2nCteFoPm3Ch6wjOws1GzG9KqTVVEhiymYUtNWP7SmQaVc4glL7nIMp+7uUHUpL6ZFwenb/g5RqAf4ZMalRHnpSDfldh3GAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABj8//////////////////8AAAAAAAAAAHzyJ+EDFdg3Kd7xQeEQVtvbHdHwh6xzDH4zlaQr/XEK",
    )
}
