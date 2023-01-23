package io.iohk.midnight.wallet.ouroboros.sync.protocol

import cats.Show
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.ouroboros.util.Enumeration

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
    final case class FindIntersect(payload: Seq[Hash]) extends Send
    case object Done extends Send
  }

  sealed trait Receive[+Block]
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
    case object AwaitReply extends Receive[Nothing]
    final case class RollForward[Block](payload: Block) extends Receive[Block]
    final case class RollBackward(payload: Hash) extends Receive[Nothing]
    final case class IntersectFound(payload: Hash) extends Receive[Nothing]
    case object IntersectNotFound extends Receive[Nothing]

    implicit def showInstance[Block]: Show[Receive[Block]] = Show.fromToString
  }

  final case class Hash(value: String) extends AnyVal {
    def toHexString: String = value
  }

  object Hash {
    implicit def hashShow: Show[Hash] = Show.show[Hash](_.toHexString)
    implicit def hashEncoder: Encoder[Hash] = Encoder[String].contramap(_.toHexString)
    implicit def hashDecoder: Decoder[Hash] = Decoder[String].map(Hash(_))
  }
}
