package io.iohk.midnight.wallet.indexer

import caliban.client.*
import caliban.client.FieldBuilder.*
import caliban.client.__Value.*

object IndexerSchema {

  type SessionId = String

  type MerkleTreeCollapsedUpdate
  object MerkleTreeCollapsedUpdate {
    def update: SelectionBuilder[MerkleTreeCollapsedUpdate, String] =
      SelectionBuilder.Field("update", Scalar())
    def lastIndex: SelectionBuilder[MerkleTreeCollapsedUpdate, BigInt] =
      SelectionBuilder.Field("lastIndex", Scalar())
  }

  type Transaction
  object Transaction {
    def hash: SelectionBuilder[Transaction, String] =
      SelectionBuilder.Field("hash", Scalar())
    def raw: SelectionBuilder[Transaction, String] =
      SelectionBuilder.Field("raw", Scalar())
  }

  type ViewingUpdate
  object ViewingUpdate {
    def merkleTreeCollapsedUpdate[A](
        innerSelection: SelectionBuilder[MerkleTreeCollapsedUpdate, A],
    ): SelectionBuilder[ViewingUpdate, Option[A]] =
      SelectionBuilder.Field("merkleTreeCollapsedUpdate", OptionOf(Obj(innerSelection)))
    def transactions[A](
        innerSelection: SelectionBuilder[Transaction, A],
    ): SelectionBuilder[ViewingUpdate, List[A]] =
      SelectionBuilder.Field("transactions", ListOf(Obj(innerSelection)))
  }

  final case class TransactionOffsetInput(
      hash: Option[String] = None,
      identifier: Option[String] = None,
  )
  object TransactionOffsetInput {
    implicit val encoder: ArgEncoder[TransactionOffsetInput] =
      new ArgEncoder[TransactionOffsetInput] {
        override def encode(value: TransactionOffsetInput): __Value =
          __ObjectValue(
            List(
              "hash" -> value.hash.fold(__NullValue: __Value)(value =>
                implicitly[ArgEncoder[String]].encode(value),
              ),
              "identifier" -> value.identifier.fold(__NullValue: __Value)(value =>
                implicitly[ArgEncoder[String]].encode(value),
              ),
            ),
          )
      }
  }

  type Mutation = Operations.RootMutation
  object Mutation {
    def connect(viewingKey: String)(implicit
        encoder0: ArgEncoder[String],
    ): SelectionBuilder[Operations.RootMutation, SessionId] =
      SelectionBuilder.Field(
        "connect",
        Scalar(),
        arguments = List(Argument("viewingKey", viewingKey, "String!")(encoder0)),
      )
    def disconnect(sessionId: SessionId)(implicit
        encoder0: ArgEncoder[SessionId],
    ): SelectionBuilder[Operations.RootMutation, Unit] =
      SelectionBuilder.Field(
        "disconnect",
        Scalar(),
        arguments = List(Argument("sessionId", sessionId, "SessionId!")(encoder0)),
      )
  }

  type Subscription = Operations.RootSubscription
  object Subscription {
    def wallet[A](
        sessionId: Option[SessionId] = None,
        transactionOffset: Option[TransactionOffsetInput] = None,
        lastIndex: Option[BigInt] = None,
    )(
        onViewingUpdate: SelectionBuilder[ViewingUpdate, A],
    )(implicit
        encoder0: ArgEncoder[Option[SessionId]],
        encoder1: ArgEncoder[Option[TransactionOffsetInput]],
        encoder2: ArgEncoder[Option[BigInt]],
    ): SelectionBuilder[Operations.RootSubscription, A] =
      SelectionBuilder.Field(
        "wallet",
        ChoiceOf(
          Map("ViewingUpdate" -> Obj(onViewingUpdate)),
        ),
        arguments = List(
          Argument("sessionId", sessionId, "SessionId")(encoder0),
          Argument("transactionOffset", transactionOffset, "TransactionOffsetInput")(encoder1),
          Argument("lastIndex", lastIndex, "BigInt")(encoder2),
        ),
      )
  }
}
