package io.iohk.midnight.wallet.core.clients.prover

import cats.Functor
import cats.syntax.functor.*
import io.circe.JsonObject
import io.iohk.midnight.wallet.core.clients.prover.ProverClient.ProofStatus
import io.iohk.midnight.wallet.core.clients.prover.ProverProtocol.Codecs.*
import io.iohk.midnight.wallet.blockchain.data.{CircuitValues, Proof, ProofId}
import sttp.client3.circe.*
import sttp.client3.{SttpBackend, emptyRequest}
import sttp.model.Uri

trait ProverClient[F[_]] {
  def prove(values: CircuitValues): F[ProofId]

  def proofStatus(proofId: ProofId): F[ProofStatus]
}

object ProverClient {
  class Live[F[_]: Functor](backend: SttpBackend[F, Any], baseUri: Uri) extends ProverClient[F] {

    private val proveUri = baseUri.addPath("prove")

    override def prove(values: CircuitValues): F[ProofId] =
      emptyRequest
        .body(values)
        .post(proveUri)
        .response(asJson[ProofIdContainer].getRight)
        .send(backend)
        .map(_.body.workId)

    private def makeProofStatusUri(proofId: ProofId) =
      baseUri.addPath("proof_statuses", proofId.value)

    override def proofStatus(proofId: ProofId): F[ProofStatus] =
      emptyRequest
        // FIXME: this should be a GET request - waiting for updates on snarike server side
        .body(JsonObject.empty)
        .post(makeProofStatusUri(proofId))
        .response(asJson[ProofStatus].getRight)
        .send(backend)
        .map(_.body)
  }

  sealed trait ProofStatus
  object ProofStatus {
    final case class Done(proof: Proof) extends ProofStatus
    case object InProgress extends ProofStatus
  }
}
