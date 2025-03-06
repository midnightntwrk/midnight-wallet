package io.iohk.midnight.wallet.core.instances

import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.domain.ProgressUpdate

import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportTopLevel("DefaultTxHistoryCapability")
@JSExportAll
class DefaultTxHistoryCapability[LocalStateNoKeys, SecretKeys, Transaction]
    extends WalletTxHistory[Wallet[LocalStateNoKeys, SecretKeys, Transaction], Transaction] {
  override def updateTxHistory(
      currentTxs: Seq[Transaction],
      newTxs: Seq[Transaction],
  ): Seq[Transaction] = currentTxs ++ newTxs

  extension (wallet: Wallet[LocalStateNoKeys, SecretKeys, Transaction]) {
    override def transactionHistory: Seq[Transaction] = wallet.txHistory
    override def progress: ProgressUpdate = wallet.progress
  }
}

class DiscardTxHistoryCapability[LocalStateNoKeys, SecretKeys, Transaction]
    extends WalletTxHistory[Wallet[LocalStateNoKeys, SecretKeys, Transaction], Transaction] {
  override def updateTxHistory(
      currentTxs: Seq[Transaction],
      newTxs: Seq[Transaction],
  ): Seq[Transaction] = Seq.empty

  extension (wallet: Wallet[LocalStateNoKeys, SecretKeys, Transaction]) {
    override def transactionHistory: Seq[Transaction] = wallet.txHistory
    override def progress: ProgressUpdate = wallet.progress
  }
}
