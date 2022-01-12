package io.iohk.midnight.wallet.clients

import cats.Id
import io.iohk.midnight.wallet.domain.*

class ProverClientStub extends ProverClient[Id]:
  override def prove(circuitValues: CircuitValues): ProofId = ProofId()

  override def proofStatus(proofId: ProofId): ProofStatus = ProofStatus.Done(Proof())

class FailingProverClient extends ProverClient[Id]:
  override def prove(circuitValues: CircuitValues): ProofId = throw new Exception("FailingProver")

  override def proofStatus(proofId: ProofId): ProofStatus = throw new Exception("FailingProver")
