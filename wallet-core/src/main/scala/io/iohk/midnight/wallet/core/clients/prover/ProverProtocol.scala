package io.iohk.midnight.wallet.core.clients.prover

import cats.syntax.functor.*
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.blockchain.data.{CircuitValues, Proof, ProofId}
import io.iohk.midnight.wallet.core.clients.prover.ProverClient.ProofStatus

object ProverProtocol {
  object Codecs {
    final case class ProofIdContainer(workId: ProofId)

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
