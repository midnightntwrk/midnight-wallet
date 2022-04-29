package io.iohk.midnight.wallet.tracer

import io.iohk.midnight.wallet.tracer.WalletTrace.Level

sealed trait ClientRequestResponseTrace extends WalletTrace {
  override def level: WalletTrace.Level = Level.Debug
}

object ClientRequestResponseTrace {

  final case class ClientRequest(request: String) extends ClientRequestResponseTrace {
    override def message: String = s"Request: $request"
  }

  final case class ClientResponse(response: String) extends ClientRequestResponseTrace {
    override def message: String = s"Response: $response"
  }
}
