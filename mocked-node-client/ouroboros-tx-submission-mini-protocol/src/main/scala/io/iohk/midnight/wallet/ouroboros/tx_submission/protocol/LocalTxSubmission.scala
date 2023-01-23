package io.iohk.midnight.wallet.ouroboros.tx_submission.protocol

import cats.{Eq, Show}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.ouroboros.util.Enumeration

private[tx_submission] object LocalTxSubmission {

  object Protocol {
    val Discriminator: String = "protocol"
    val Name: String = "LocalTxSubmission"
  }

  sealed trait Send[+Transaction]
  object Send {

    sealed abstract class Type(val entryName: String) extends Enumeration.Value(entryName)
    object Type {
      val Discriminator = "type"
      case object SubmitTx extends Type("SubmitTx")
      case object Done extends Type("Done")
      implicit val enumInstance: Enumeration[Type] = new Enumeration[Type] {
        override val Discriminator: String = Type.Discriminator
        override val allValues: Seq[Type] = Seq(SubmitTx, Done)
      }
    }
    final case class SubmitTx[Transaction](payload: Transaction) extends Send[Transaction]
    case object Done extends Send[Nothing]
  }

  sealed trait Receive
  object Receive {
    sealed abstract class Type(val entryName: String) extends Enumeration.Value(entryName)
    object Type {
      val Discriminator = "type"
      case object AcceptTx extends Type("AcceptTx")
      case object RejectTx extends Type("RejectTx")
      implicit val enumInstance: Enumeration[Type] = new Enumeration[Type] {
        override val Discriminator: String = Type.Discriminator
        override val allValues: Seq[Type] = Seq(AcceptTx, RejectTx)
      }
    }

    case object AcceptTx extends Receive
    final case class RejectTx(payload: RejectTxDetails) extends Receive
    sealed trait RejectTxDetails {
      def reason: String
    }
    object RejectTxDetails {
      sealed abstract class Type(val entryName: String) extends Enumeration.Value(entryName)
      object Type {
        val Discriminator = "type"
        case object Duplicate extends Type("Duplicate")
        case object Other extends Type("Other")
        implicit val enumInstance: Enumeration[Type] = new Enumeration[Type] {
          override val Discriminator: String = Type.Discriminator
          override val allValues: Seq[Type] = Seq(Duplicate, Other)
        }
      }
      case object Duplicate extends RejectTxDetails {
        override val reason: String = "Duplicate"
      }
      final case class Other(reason: String) extends RejectTxDetails
    }
  }

  final case class Hash(value: String) extends AnyVal {
    def toHexString: String = value
  }

  object Hash {
    implicit def hashShow: Show[Hash] = Show.show[Hash](_.toHexString)
    implicit def hashEncoder: Encoder[Hash] = Encoder[String].contramap(_.toHexString)
    implicit def hashDecoder: Decoder[Hash] = Decoder[String].map(Hash(_))
    implicit def hashEq[T]: Eq[Hash] = Eq.fromUniversalEquals[Hash]
  }
}
