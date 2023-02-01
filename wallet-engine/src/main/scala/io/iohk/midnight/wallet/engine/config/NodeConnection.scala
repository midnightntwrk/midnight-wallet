package io.iohk.midnight.wallet.engine.config

import cats.Show
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction
import io.iohk.midnight.midnightMockedNodeApi.distMockedNodeMod.MockedNode
import sttp.model.Uri

sealed trait NodeConnection
object NodeConnection {
  final case class NodeUri(uri: Uri) extends NodeConnection
  final case class NodeInstance(instance: MockedNode[Transaction]) extends NodeConnection

  implicit val showInstance: Show[NodeConnection] = {
    case NodeUri(uri)    => uri.toString()
    case _: NodeInstance => "node instance"
  }
}

sealed trait RawNodeConnection
object RawNodeConnection {
  final case class RawNodeUri(uri: String) extends RawNodeConnection
  final case class RawNodeInstance(instance: MockedNode[Transaction]) extends RawNodeConnection

  implicit val showInstance: Show[RawNodeConnection] = {
    case RawNodeUri(uri)    => uri
    case _: RawNodeInstance => "raw node instance"
  }
}
