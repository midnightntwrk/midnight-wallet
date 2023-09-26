package io.iohk.midnight.wallet

import io.iohk.midnight.midnightZswap.mod.Transaction
import io.iohk.midnight.buffer.mod.Buffer

package object substrate {

  case class SubmitTransactionRequest(transaction: Transaction)

  case class SubmitTransactionResponse(result: ExtrinsicsHash | RpcError)

  case class ExtrinsicsHash(hash: Buffer)

  case class RpcError(code: Int, message: String, data: String)

}
