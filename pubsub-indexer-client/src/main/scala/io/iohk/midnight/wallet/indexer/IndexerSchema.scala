package io.iohk.midnight.wallet.indexer

import caliban.client.*
import caliban.client.FieldBuilder.*

object IndexerSchema {

  type SessionId = String

  type MerkleTreeCollapsedUpdate
  object MerkleTreeCollapsedUpdate {
    def update: SelectionBuilder[MerkleTreeCollapsedUpdate, String] =
      SelectionBuilder.Field("update", Scalar())
  }

  type RelevantTransaction
  object RelevantTransaction {
    def transaction[A](
        innerSelection: SelectionBuilder[Transaction, A],
    ): SelectionBuilder[RelevantTransaction, A] =
      SelectionBuilder.Field("transaction", Obj(innerSelection))
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
    def blockHeight: SelectionBuilder[ViewingUpdate, BigInt] =
      SelectionBuilder.Field("blockHeight", Scalar())
    def update[A](
        onMerkleTreeCollapsedUpdate: SelectionBuilder[MerkleTreeCollapsedUpdate, A],
        onRelevantTransaction: SelectionBuilder[RelevantTransaction, A],
    ): SelectionBuilder[ViewingUpdate, List[A]] = SelectionBuilder.Field(
      "update",
      ListOf(
        ChoiceOf(
          Map(
            "MerkleTreeCollapsedUpdate" -> Obj(onMerkleTreeCollapsedUpdate),
            "RelevantTransaction" -> Obj(onRelevantTransaction),
          ),
        ),
      ),
    )
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
        blockHeight: Option[BigInt] = None,
    )(
        onViewingUpdate: SelectionBuilder[ViewingUpdate, A],
    )(implicit
        encoder0: ArgEncoder[Option[SessionId]],
        encoder1: ArgEncoder[Option[BigInt]],
    ): SelectionBuilder[Operations.RootSubscription, A] =
      SelectionBuilder.Field(
        "wallet",
        ChoiceOf(
          Map("ViewingUpdate" -> Obj(onViewingUpdate)),
        ),
        arguments = List(
          Argument("sessionId", sessionId, "SessionId")(encoder0),
          Argument("blockHeight", blockHeight, "BigInt")(encoder1),
        ),
      )
  }

}
