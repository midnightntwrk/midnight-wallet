// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { Effect, Context, Effectable, Option, identity } from 'effect';
import { ClientError, ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { QueryClient } from './QueryClient.js';

/**
 * Describes an invocable GraphQL query.
 */
export interface Query<R, V, F extends Query.QueryFn<R, V> = Query.QueryFn<R, V>> extends Effect.Effect<F> {
  readonly tag: Context.Tag<Query<R, V>, F>;
  readonly run: F;
}

export declare namespace Query {
  /**
   * A GraphQL query (that may be parameterized with variables), that returns a typed document.
   *
   * @typeParam R The type returned by the GraphQL query.
   * @typeParam V A type that describes the variables present in the GraphQL query.
   *
   * @remarks
   * `Document` is a simple type alias for `TypedDocumentNode`.
   */
  export type Document<R, V> = TypedDocumentNode<R, V>;

  /**
   * The variables of a {@link Document}.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Variables<T> = T extends Document<any, infer V> ? V : never;

  /**
   * The expected result of executing a {@link Document}.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Result<T> = T extends Document<infer R, any> ? R : never;

  /**
   * Describes a function that executes a GraphQL query over some given variables.
   *
   * @param variables The variables to be used in the GraphQL query.
   * @returns An `Effect` that will yield the result of the GraphQL query.
   */
  export type QueryFn<R, V> = (variables: V) => Effect.Effect<R, ClientError | ServerError, QueryClient>;
}

/**
 * Constructs a new invocable GraphQL query.
 *
 * @param name The name of the tag to be associated with this query.
 * @param document A parsed GraphQL query document that represents the query.
 * @returns A {@link Query}.
 */
export const make: <Name extends string, T extends Query.Document<R, V>, R = Query.Result<T>, V = Query.Variables<T>>(
  name: Name,
  document: T,
) => Query<R, V> = <Name extends string, T extends Query.Document<R, V>, R = Query.Result<T>, V = Query.Variables<T>>(
  name: Name,
  document: T,
) => new QueryImpl<R, V, T>(`${name}Query`, document);

class QueryImpl<
    R,
    V,
    T extends Query.Document<R, V> = Query.Document<R, V>,
    F extends Query.QueryFn<R, V> = Query.QueryFn<R, V>,
  >
  extends Effectable.Class<F>
  implements Query<R, V, F>
{
  readonly name: string;
  protected readonly document: T;

  constructor(name: string, document: T) {
    super();
    this.document = document;
    this.name = name;
    this.tag = Context.GenericTag(name);
    this.run = ((variables: V) => Effect.flatMap(this, (f) => f(variables))) as F;
  }

  readonly tag: Context.Tag<Query<R, V>, F>;
  readonly run: F;

  commit() {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
    return Effect.gen(function* () {
      return Option.match(yield* Effect.serviceOption(self.tag), {
        onSome: identity,
        onNone: () => self.defaultFn.bind(self) as F,
      });
    });
  }

  private defaultFn(variables: V): Effect.Effect<R, ClientError | ServerError, QueryClient> {
    return QueryClient.pipe(Effect.flatMap((client) => client.query(this.document, variables)));
  }
}
