package io.iohk.midnight.wallet.ogmios.tx_submission.tracing

import io.iohk.midnight.wallet.blockchain.data.Transaction

sealed trait OgmiosTxSubmissionEvent

object OgmiosTxSubmissionEvent {

  /** The given transaction has been submitted to the Ogmios server/bridge.
    */
  final case class TxSubmitted(tx: Transaction) extends OgmiosTxSubmissionEvent

  /** The submitted transaction has been accepted.
    */
  final case class TxAccepted(tx: Transaction) extends OgmiosTxSubmissionEvent

  /** The submitted transaction has been rejected for the given reason.
    */
  final case class TxRejected(tx: Transaction, reason: String) extends OgmiosTxSubmissionEvent

  /** The response from the server could not be processed due to the given error.
    */
  final case class ProcessingReceivedMessageFailed(exception: Exception)
      extends OgmiosTxSubmissionEvent

}
