package io.iohk.midnight.wallet.clients.platform.protocol

import enumeratum.EnumEntry.*
import enumeratum.*

sealed trait TransactionKind extends EnumEntry

object TransactionKind extends Enum[TransactionKind] {
  val Discriminator: String = "kind"

  case object Lares extends TransactionKind with Lowercase

  val values: IndexedSeq[TransactionKind] = findValues
}
