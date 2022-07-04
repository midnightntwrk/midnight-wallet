package io.iohk.midnight.wallet.ogmios.tx_submission.protocol

import io.iohk.midnight.wallet.ogmios.tx_submission.util.Enumeration

// [TODO NLLW-361]
private[tx_submission] sealed abstract class TransactionType(val entryName: String)
    extends Enumeration.Value(entryName)

private[tx_submission] object TransactionType {
  val Discriminator: String = "type"
  case object Call extends TransactionType("call")
  case object Deploy extends TransactionType("deploy")

  implicit val enumInstance: Enumeration[TransactionType] = new Enumeration[TransactionType] {
    override val Discriminator: String = TransactionType.Discriminator
    override val allValues: Seq[TransactionType] = Seq(Call, Deploy)
  }
}
