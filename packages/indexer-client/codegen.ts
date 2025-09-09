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
