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
import type { CodegenConfig } from '@graphql-codegen/cli';

//
// This file provides configuration for the GraphQL code generator. It combines:
// - The Indexer GraphQL (`indexer.gql`),
// - Queries from `graphql/queries`
// - Subscriptions from `graphql/subscriptions`
//
// Generated types are then written to `graphql/generated`.
//

export default {
  generates: {
    './src/graphql/generated/': {
      documents: ['./src/graphql/queries/*.ts', './src/graphql/subscriptions/*.ts'],
      schema: './indexer.gql',
      preset: 'client',
      config: {
        avoidOptionals: true,
        skipTypename: true,
        skipTypeNameForRoot: true,
        enumsAsTypes: true,
        futureProofEnums: true,
        immutableTypes: true,
        useTypeImports: true,
        strictScalars: true,
        scalars: {
          BigInt: 'number',
          SessionId: 'string',
          WalletLocalState: 'string',
          Unit: 'null',
          Instant: 'number',
          ApplyStage: 'string',
          HexEncoded: 'string',
          ViewingKey: 'string',
          UnshieldedAddress: 'string',
        },
        namingConvention: {
          transformUnderscore: true,
        },
      },
      presetConfig: {
        gqlTagName: 'gql',
      },
      hooks: { afterAllFileWrite: ['prettier --write'] },
    },
  },
} as CodegenConfig;
