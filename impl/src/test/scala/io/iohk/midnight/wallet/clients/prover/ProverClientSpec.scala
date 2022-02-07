package io.iohk.midnight.wallet.clients.prover

import cats.Functor
import cats.effect.IO
import io.iohk.midnight.wallet.clients.prover.ProverClient.ProofStatus
import io.iohk.midnight.wallet.domain.{CircuitValues, Proof, ProofId}
import io.iohk.midnight.wallet.domain.Generators.*
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF.forAllF
import sttp.client3.*
import sttp.client3.impl.cats.CatsMonadError
import sttp.client3.testing.*
import sttp.model.*

trait ProverClientSpec {
  private val inProgressStatusResponse = """{"result":"in_progress"}"""

  private def workIdResponse(proofId: ProofId) = s"""{"work_id":"${proofId.value}"}"""

  private def doneStatusResponse(proof: Proof) =
    s"""{"result":"done","proof":"${proof.value}"}"""

  def circuitValuesBodyRequest(circuitValues: CircuitValues) =
    s"""{"x":${circuitValues.x.toString},"y":${circuitValues.y.toString},"z":${circuitValues.z.toString}}"""

  val sttpBackendStub = SttpBackendStub
    .apply[IO, Any](new CatsMonadError[IO])

  def buildProveSttpBackend(proofId: ProofId) =
    sttpBackendStub
      .whenRequestMatches(_.uri.path.lastOption.contains("prove"))
      .thenRespond(workIdResponse(proofId))

  val buildProveSttpBackend2 =
    sttpBackendStub
      .whenRequestMatches(_.uri.path.lastOption.contains("prove"))
      .thenRespondOk()

  val inProgressSttpBackend =
    sttpBackendStub
      .whenRequestMatches(_.uri.path.contains("proof_statuses"))
      .thenRespond(inProgressStatusResponse)

  def buildDoneStatusSttpBackend(proof: Proof) =
    sttpBackendStub
      .whenRequestMatches(_.uri.path.contains("proof_statuses"))
      .thenRespond(doneStatusResponse(proof))

  def buildProveBodySttpBackend(proofId: ProofId, circuitValues: CircuitValues) =
    sttpBackendStub
      .whenRequestMatches(compareStringBody(_, circuitValuesBodyRequest(circuitValues)))
      .thenRespond(workIdResponse(proofId))

  def buildEmptyBodyStatusSttpBackend(proof: Proof) =
    sttpBackendStub
      .whenRequestMatches(compareStringBody(_, "{}"))
      .thenRespond(doneStatusResponse(proof))

  private def compareStringBody(request: Request[_, _], expectedBody: String): Boolean =
    request.body match {
      case body: StringBody => body.s == expectedBody.filterNot(_.isWhitespace)
      case _                => false
    }

  def buildStatusPathSttpBackend(proofId: ProofId, proof: Proof) =
    sttpBackendStub
      .whenRequestMatches(
        _.uri.toString == testingBaseUri.addPath("proof_statuses", proofId.value).toString,
      )
      .thenRespond(doneStatusResponse(proof))

  val testingBaseUri = Uri("testing")

  def buildProverClient[F[_]: Functor](
      backend: SttpBackend[F, Any],
  ): ProverClient[F] =
    new ProverClient.Live[F](
      backend,
      testingBaseUri,
    )
}

class ProverClientProveSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with ProverClientSpec {
  test("a proof Id is returned") {
    forAllF(circuitValuesGen, proofIdGen) { (circuitValues: CircuitValues, proofId: ProofId) =>
      val proverClient = buildProverClient(
        buildProveSttpBackend(proofId),
      )
      proverClient
        .prove(circuitValues)
        .map(r => assert(r.value == proofId.value))
    }
  }

  test("body of the request is encoded correctly") {
    forAllF(circuitValuesGen, proofIdGen) { (circuitValues: CircuitValues, proofId: ProofId) =>
      val proverClient = buildProverClient(
        buildProveBodySttpBackend(proofId, circuitValues),
      )
      proverClient
        .prove(circuitValues)
        .map(r => assert(r.value == proofId.value))
    }
  }
}

class ProverClientProofStatusSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with ProverClientSpec {
  test("in progress status is returned") {
    forAllF(proofIdGen) { (proofId: ProofId) =>
      val proverClient = buildProverClient(
        inProgressSttpBackend,
      )
      proverClient
        .proofStatus(proofId)
        .map(assertEquals(_, ProofStatus.InProgress))
    }
  }

  test("done status and proof are returned") {
    forAllF(proofIdGen, proofGen) { (proofId: ProofId, proof: Proof) =>
      val proverClient = buildProverClient(
        buildDoneStatusSttpBackend(proof),
      )
      proverClient
        .proofStatus(proofId)
        .map(assertEquals(_, ProofStatus.Done(proof)))
    }
  }

  test("body of the request is empty") {
    forAllF(proofIdGen, proofGen) { (proofId: ProofId, proof: Proof) =>
      val proverClient = buildProverClient(
        buildEmptyBodyStatusSttpBackend(proof),
      )
      proverClient
        .proofStatus(proofId)
        .map(assertEquals(_, ProofStatus.Done(proof)))
    }
  }

  test("path of the request is built correctly") {
    forAllF(proofIdGen, proofGen) { (proofId: ProofId, proof: Proof) =>
      val proverClient = buildProverClient(
        buildStatusPathSttpBackend(proofId, proof),
      )
      proverClient
        .proofStatus(proofId)
        .map(assertEquals(_, ProofStatus.Done(proof)))
    }
  }
}
