package io.iohk.midnight.wallet.clients.prover

import io.iohk.midnight.wallet.clients.prover.ProverClient.ProofStatus
import io.iohk.midnight.wallet.domain.*

trait ProverClient[F[_]] {
  def prove(values: CircuitValues): F[ProofId]

  def proofStatus(proofId: ProofId): F[ProofStatus]
}

object ProverClient {
  sealed trait ProofStatus
  object ProofStatus {
    case class Done(proof: Proof) extends ProofStatus
    case object InProgress extends ProofStatus
  }
}
