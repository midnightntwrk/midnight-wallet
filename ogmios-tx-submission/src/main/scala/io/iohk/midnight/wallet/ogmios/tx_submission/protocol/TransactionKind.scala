package io.iohk.midnight.wallet.ogmios.tx_submission.protocol

import io.iohk.midnight.wallet.ogmios.tx_submission.util.Enumeration

private[tx_submission] sealed abstract class TransactionKind(val entryName: String)
    extends Enumeration.Value(entryName)

private[tx_submission] object TransactionKind {
  val Discriminator: String = "kind"

  case object Lares extends TransactionKind("lares")

  implicit val enumInstance: Enumeration[TransactionKind] = new Enumeration[TransactionKind] {
    override val Discriminator: String = TransactionKind.Discriminator
    override val allValues: Seq[TransactionKind] = Seq(Lares)
  }
}
