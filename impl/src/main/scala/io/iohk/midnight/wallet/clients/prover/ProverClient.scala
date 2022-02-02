package io.iohk.midnight.wallet.clients.prover

import cats.Functor
import cats.implicits.toFunctorOps
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.clients.prover.ProverClient.ProofStatus
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Proof
import io.iohk.midnight.wallet.domain.ProofId
import sttp.client3.{SttpBackend, emptyRequest}
import sttp.client3.circe.*
import sttp.model.Uri

trait ProverClient[F[_]] {
  def prove(values: CircuitValues): F[ProofId]

  def proofStatus(proofId: ProofId): F[ProofStatus]
}

object ProverClient {
  class Live[F[_]: Functor](backend: SttpBackend[F, Any], baseUri: Uri) extends ProverClient[F] {
    import Codecs.*

    private val proveUri = baseUri.addPath("prove")

    override def prove(values: CircuitValues): F[ProofId] =
      emptyRequest
        .body(values)
        .post(proveUri)
        .response(asJson[ProofIdContainer].getRight)
        .send(backend)
        .map(_.body.workId)

    private def makeProofStatusUri(proofId: ProofId) =
      baseUri.addPath(s"/proof_statuses/${proofId.value}")

    override def proofStatus(proofId: ProofId): F[ProofStatus] =
      emptyRequest
        .get(makeProofStatusUri(proofId))
        .response(asJson[ProofStatus].getRight)
        .send(backend)
        .map(_.body)

    private object Codecs {
      case class ProofIdContainer(workId: ProofId)

      implicit val circuitValuesEncoder: Encoder[CircuitValues] = deriveEncoder

      implicit val proofIdDecoder: Decoder[ProofId] = Decoder[String].map(ProofId(_))

      implicit val proofIdContainerDecoder: Decoder[ProofIdContainer] =
        Decoder.instance(_.get[ProofId]("work_id")).map(ProofIdContainer(_))

      implicit val proofDecoder: Decoder[Proof] = Decoder[String].map(Proof(_))

      implicit val doneProofStatusDecoder: Decoder[ProofStatus.Done] = deriveDecoder

      implicit val proofStatusDecoder: Decoder[ProofStatus] =
        Decoder.instance(_.get[String]("result")).flatMap {
          case "in_progress" => Decoder.const(ProofStatus.InProgress)
          case "done"        => Decoder[ProofStatus.Done].widen
          case _ => Decoder.failedWithMessage("Proof status must be one of (in_progress, done)")
        }
    }
  }

  sealed trait ProofStatus
  object ProofStatus {
    final case class Done(proof: Proof) extends ProofStatus
    case object InProgress extends ProofStatus
  }
}
