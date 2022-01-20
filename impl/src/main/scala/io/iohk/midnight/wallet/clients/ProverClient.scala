package io.iohk.midnight.wallet.clients

import io.iohk.midnight.wallet.domain.*

trait ProverClient[F[_]]:
  def prove(values: CircuitValues): F[ProofId]

  def proofStatus(proofId: ProofId): F[ProofStatus]
