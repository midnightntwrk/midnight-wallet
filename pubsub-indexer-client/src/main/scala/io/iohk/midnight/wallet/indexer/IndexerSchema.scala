package io.iohk.midnight.wallet.indexer

import caliban.client.FieldBuilder.*
import caliban.client.*

object IndexerSchema {

  type SessionId = String

  type Transaction
  object Transaction {
    def hash: SelectionBuilder[Transaction, String] =
      SelectionBuilder.Field("hash", Scalar())
    def raw: SelectionBuilder[Transaction, String] =
      SelectionBuilder.Field("raw", Scalar())
  }

  type TransactionAdded

  object TransactionAdded {
    def transaction[A](
        innerSelection: SelectionBuilder[Transaction, A],
    ): SelectionBuilder[TransactionAdded, A] =
      SelectionBuilder.Field("transaction", Obj(innerSelection))
  }

  type Mutation = Operations.RootMutation
  object Mutation {
    def connect(viewingKey: String)(implicit
        encoder0: ArgEncoder[String],
    ): SelectionBuilder[Operations.RootMutation, SessionId] =
      SelectionBuilder.Field(
        "connect",
        Scalar(),
        arguments = List(Argument("viewingKey", viewingKey, "String")(encoder0)),
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
    def transactions[A](sessionId: Option[SessionId], hash: scala.Option[String] = None)(
        onTransactionAdded: SelectionBuilder[TransactionAdded, A],
    )(implicit
        encoder0: ArgEncoder[Option[SessionId]],
        encoder1: ArgEncoder[scala.Option[String]],
    ): SelectionBuilder[Operations.RootSubscription, A] =
      SelectionBuilder.Field(
        "transactions",
        ChoiceOf(
          Map("TransactionAdded" -> Obj(onTransactionAdded)),
        ),
        arguments = List(
          Argument("sessionId", sessionId, "SessionId")(encoder0),
          Argument("hash", hash, "String")(encoder1),
        ),
      )
  }

}
