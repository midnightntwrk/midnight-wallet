package io.iohk.midnight.wallet.tracer

import cats.effect.IO
import cats.implicits.*
import cats.{Applicative, Id}
import io.iohk.midnight.wallet.tracer.TracerSyntax.*
import io.iohk.midnight.wallet.util.BetterOutputSuite
import munit.CatsEffectSuite

import scala.collection.mutable

@SuppressWarnings(
  Array("org.wartremover.warts.MutableDataStructures", "org.wartremover.warts.Throw"),
)
class TracerSpec extends CatsEffectSuite with BetterOutputSuite {

  // Trace
  case class Trace(id: String, msg: String)
  val event1: Trace = Trace("1", "humble beginning")
  val event42: Trace = Trace("42", "what is the meaning of life")
  val expectedResult: List[Trace] = List(event1, event42)

  test(" Tracer traces provided values for Id effect") {
    // given
    val traceSpy = mutable.ListBuffer[Trace]()

    val tracer: Tracer[Id, Trace] = TracerSpy[Id, Trace](traceSpy)

    // when
    tracer(event1)
    tracer(event42)

    // then
    assertEquals(traceSpy.toList, expectedResult)
  }

  test("Tracer traces provided values for IO effect") {
    // given
    val traceSpy = mutable.ListBuffer[Trace]()
    val tracer = TracerSpy[IO, Trace](traceSpy)

    // when
    val tracing = tracer(event1) >> tracer(event42)

    // then
    assertIO(tracing.as(traceSpy).map(_.toList), expectedResult)
  }

  // traceAll
  case class Message(id: Int, msg: List[String])
  val message: Message = Message(42, List("CoinbaseTransaction", "TransferTransaction"))

  def traceFromMessage: Message => List[Trace] =
    m =>
      m.msg.zipWithIndex.map { case (msg, idx) =>
        Trace(s"0x_${m.id.toString}_${idx.toString}", msg)
      }

  test("trace all elements returned from transforming function") {
    // given
    val traceSpy = mutable.ListBuffer[Trace]()
    val eventTracer: Tracer[IO, Trace] = TracerSpy[IO, Trace](traceSpy)

    // when
    val msgTracer: Tracer[IO, Message] = eventTracer.traceAll(traceFromMessage)
    val tracing = msgTracer.trace(message)

    assertIO(
      tracing.as(traceSpy).map(_.toList),
      List(
        Trace("0x_42_0", "CoinbaseTransaction"),
        Trace("0x_42_1", "TransferTransaction"),
      ),
    )
  }

  test("traceAll with Option works as contramap + filter") {
    // given
    val traceSpy = mutable.ListBuffer[Trace]()
    val eventTracer: Tracer[IO, Trace] = TracerSpy[IO, Trace](traceSpy)

    def traceFromMessage: Message => Option[Trace] =
      m =>
        if (m.msg.contains("CoinbaseTransaction")) Some(Trace(m.id.toString, s"Block mined"))
        else None

    // when
    val msgTracer: Tracer[IO, Message] = eventTracer.traceAll(traceFromMessage)

    val message1 = Message(41, List("CoinbaseTransaction", "TransferTransaction"))
    val message2 = Message(42, List("TransferTransaction"))
    val tracing = msgTracer.trace(message1) >> msgTracer.trace(message2)

    assertIO(
      tracing.as(traceSpy).map(_.toList),
      List(
        Trace("41", "Block mined"),
      ),
    )
  }

  // filter
  test("filters out matching values") {
    import TracerSyntax.TracerOps
    // given
    val traceSpy = mutable.ListBuffer[String]()
    val tracer: Tracer[Id, String] = TracerSpy[Id, String](traceSpy)

    val traceComposable = tracer.filter(!_.contains("Monad"))

    // when
    traceComposable("Functor")
    traceComposable("Applicative")
    traceComposable("Monad")
    traceComposable("Contravariant")
    traceComposable("Profunctor")

    // then
    assertEquals(
      traceSpy.toList,
      List(
        "Functor",
        "Applicative",
        "Contravariant",
        "Profunctor",
      ),
    )
  }

  // filterNot
  test("filters out non matching values") {
    import TracerSyntax.TracerOps
    // given
    val traceSpy = mutable.ListBuffer[String]()
    val tracer: Tracer[Id, String] = TracerSpy[Id, String](traceSpy)

    val traceComposable = tracer.filterNot(_.contains("Monad"))

    // when
    traceComposable("Functor")
    traceComposable("Applicative")
    traceComposable("Monad")
    traceComposable("Contravariant")
    traceComposable("Profunctor")

    // then
    assertEquals(
      traceSpy.toList,
      List(
        "Functor",
        "Applicative",
        "Contravariant",
        "Profunctor",
      ),
    )
  }

  // filterM
  test("filters out matching values (filterM)") {
    import TracerSyntax.TracerOps
    // given
    val traceSpy = mutable.ListBuffer[String]()
    val tracer: Tracer[Id, String] = TracerSpy[Id, String](traceSpy)

    val traceComposable = tracer.filterM(Id(!_.contains("Monad")))

    // when
    traceComposable("Functor")
    traceComposable("Applicative")
    traceComposable("Monad")
    traceComposable("Contravariant")
    traceComposable("Profunctor")

    // then
    assertEquals(
      traceSpy.toList,
      List(
        "Functor",
        "Applicative",
        "Contravariant",
        "Profunctor",
      ),
    )
  }

  test("do contravariant tracing") {
    case class DomainEvent(name: String, msg: String)

    // given
    val traceSpy = mutable.ListBuffer[String]()
    val tracer: Tracer[Id, String] = TracerSpy[Id, String](traceSpy)

    def asJson: DomainEvent => String = e => s""" { "n": ${e.name}, "m": "${e.msg}"} """.trim

    val traceComposable = tracer.contramap(asJson)

    // when
    traceComposable(DomainEvent("block", "saved"))

    // then
    assertEquals(traceSpy.toList, List("""{ "n": block, "m": "saved"}"""))
  }

  // noOp tracer
  test("noOpTracer for Id do not evaluate its arguments") {
    val tracer: Tracer[Id, String] = Tracer.noOpTracer
    tracer(throw new RuntimeException("Please do not evaluate me"))
    assert(cond = true)
  }

  test("noOpTracer for IO do not evaluate its arguments") {
    val tracer: Tracer[IO, String] = Tracer.noOpTracer
    val _ = tracer(throw new RuntimeException("Please do not evaluate me"))
    assert(cond = true)
  }

}

final case class TracerSpy[F[_]: Applicative, Event](memory: mutable.ListBuffer[Event])
    extends Tracer[F, Event] {

  override def apply(a: => Event): F[Unit] = {
    Applicative[F].pure {
      val _ = memory += a
      ()
    }
  }
}
