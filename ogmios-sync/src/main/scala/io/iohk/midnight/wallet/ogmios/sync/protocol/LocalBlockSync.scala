package io.iohk.midnight.wallet.ogmios.sync.protocol

import cats.Show
import io.iohk.midnight.wallet.domain.{Block, Hash}
import io.iohk.midnight.wallet.ogmios.sync.util.Enumeration

private[sync] object LocalBlockSync {

  object Protocol {
    val Discriminator: String = "protocol"
    val Name: String = "LocalBlockSync"
  }

  sealed trait Send
  object Send {
    sealed abstract class Type(val entryName: String) extends Enumeration.Value(entryName)
    object Type {
      val Discriminator = "type"
      case object RequestNext extends Type("RequestNext")
      case object FindIntersect extends Type("FindIntersect")
      case object Done extends Type("Done")
      implicit val enumInstance: Enumeration[Type] = new Enumeration[Type] {
        override val Discriminator: String = Type.Discriminator
        override val allValues: Seq[Type] = Seq(RequestNext, FindIntersect, Done)
      }
    }

    case object RequestNext extends Send
    final case class FindIntersect(payload: Seq[Hash[Block]]) extends Send
    case object Done extends Send
  }

  sealed trait Receive
  object Receive {
    sealed abstract class Type(val entryName: String) extends Enumeration.Value(entryName)
    object Type {
      val Discriminator = "type"
      case object AwaitReply extends Type("AwaitReply")
      case object RollForward extends Type("RollForward")
      case object RollBackward extends Type("RollBackward")
      case object IntersectFound extends Type("IntersectFound")
      case object IntersectNotFound extends Type("IntersectNotFound")
      implicit val enumInstance: Enumeration[Type] = new Enumeration[Type] {
        override val Discriminator: String = Type.Discriminator
        override val allValues: Seq[Type] =
          Seq(AwaitReply, RollForward, RollBackward, IntersectFound, IntersectNotFound)
      }
    }
    case object AwaitReply extends Receive
    final case class RollForward(payload: Block) extends Receive
    final case class RollBackward(payload: Hash[Block]) extends Receive
    final case class IntersectFound(payload: Hash[Block]) extends Receive
    case object IntersectNotFound extends Receive

    implicit val showInstance: Show[Receive] = Show.fromToString
  }
}
