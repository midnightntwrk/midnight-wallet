package io.iohk.midnight.wallet.clients

import io.iohk.midnight.wallet.clients.ProverClient.ProofStatus
import io.iohk.midnight.wallet.domain.*

trait ProverClient[F[_]]:
  def prove(values: CircuitValues): F[ProofId]

  def proofStatus(proofId: ProofId): F[ProofStatus]

object ProverClient:
  enum ProofStatus derives CanEqual:
    case Done(proof: Proof)
    case InProgress
