package io.iohk.midnight.wallet

import io.iohk.midnight.wallet.zswap.{NetworkId, Transaction}
import io.iohk.midnight.buffer.mod.Buffer

package object substrate {

  case class SubmitTransactionRequest(transaction: Transaction, networkId: NetworkId)

  case class SubmitTransactionResponse(result: ExtrinsicsHash | RpcError)

  case class ExtrinsicsHash(hash: Buffer)

  case class RpcError(code: Int, message: String, data: String)

}
