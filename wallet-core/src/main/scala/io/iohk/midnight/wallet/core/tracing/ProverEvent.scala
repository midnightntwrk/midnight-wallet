package io.iohk.midnight.wallet.core.tracing

import io.iohk.midnight.wallet.blockchain.data.CircuitValues
import io.iohk.midnight.wallet.blockchain.data.ProofId
import io.iohk.midnight.wallet.core.clients.prover.ProverClient

trait ProverEvent

object ProverEvent {

  /** The `ProverService` received a request to get a proof for the given circuit values.
    */
  final case class RequestProof(circuitValues: CircuitValues) extends ProverEvent

  /** The request to generate a proof has been submitted. Since generating a proof takes some time,
    * a proof id has been returned that can be used to query the progress.
    */
  final case class ProofRequestSubmitted(proofId: ProofId) extends ProverEvent

  /** The status of the proof generation is periodically polled.
    */
  final case class PollProofStatus(proofId: ProofId, remainingRetries: Int) extends ProverEvent

  /** A response to polling the proof status has been received.
    */
  final case class ProofStatusResponse(status: ProverClient.ProofStatus) extends ProverEvent

}
