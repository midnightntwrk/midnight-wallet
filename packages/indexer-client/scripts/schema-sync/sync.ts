// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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

//
// CLI entry for the indexer GraphQL schema sync tool. It does the I/O — GitHub
// API, filesystem, codegen — and delegates every decision to the pure logic in
// `./lib`. Run from the repo root:
//
//   yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client                 # verify (default)
//   yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client -- --tag v4.3.3 # pin a version
//   yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client -- --update     # re-apply the pin
//
// See ./README.md for the full behaviour matrix.
//

import { Console, Data, Effect, Layer, Option, Schema, pipe } from 'effect';
import { Command, FetchHttpClient, FileSystem, HttpClient, HttpClientRequest } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  type Provenance,
  type SchemaLock,
  SyncCommand,
  UpdateOutcome,
  VerifyOutcome,
  decideUpdate,
  decideVerify,
  decodeConfig,
  parseArgs,
  pickSchemaFile,
  renderConfig,
  renderFile,
  sha256Hex,
  stripHeader,
} from './lib/index.js';

/** All failures of the sync tool. Printed by `NodeRuntime.runMain`, which then exits non-zero. */
class SchemaSyncError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-indexer-client/scripts/schema-sync/sync/SchemaSyncError',
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Paths resolved relative to this script, so cwd does not matter.
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const packageDir = path.resolve(scriptDir, '..', '..');
const configPath = path.join(packageDir, 'schema.lock');
const schemaPath = path.join(packageDir, 'indexer.gql');
const generatedDir = path.join(packageDir, 'src', 'graphql', 'generated');

const githubToken = process.env['GITHUB_TOKEN'] ?? process.env['MIDNIGHT_GH_TOKEN'] ?? process.env['GH_TOKEN'];

const githubHeaders = (accept: string): Record<string, string> => ({
  Accept: accept,
  'User-Agent': 'midnight-wallet-schema-sync',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(githubToken !== undefined ? { Authorization: `Bearer ${githubToken}` } : {}),
});

const contentsUrl = (repo: string, filePath: string, tag: string): string =>
  `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(tag)}`;

/** Fetch a resource as text, failing on any non-2xx status. */
const fetchText = (url: string, accept: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(githubHeaders(accept))),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new SchemaSyncError({ message: `GitHub API ${response.status} for ${url}` });
    }
    return yield* response.text;
  });

const DirEntrySchema = Schema.Array(Schema.Struct({ name: Schema.String }));

/** Fetch the schema file's bytes as text. */
const fetchSchema = (repo: string, filePath: string, tag: string) =>
  fetchText(contentsUrl(repo, filePath, tag), 'application/vnd.github.raw');

/** Resolve the commit SHA a tag points to (informational provenance). */
const fetchCommit = (repo: string, tag: string) =>
  fetchText(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(tag)}`,
    'application/vnd.github.sha',
  ).pipe(Effect.map((sha) => sha.trim()));

/** Auto-discover the highest `schema-vN.graphql` in the same directory as the pinned path. */
const discoverSchemaPath = (repo: string, tag: string, currentPath: string) =>
  Effect.gen(function* () {
    const dir = path.posix.dirname(currentPath);
    const text = yield* fetchText(contentsUrl(repo, dir, tag), 'application/vnd.github+json');
    const entries = yield* Schema.decodeUnknown(DirEntrySchema)(JSON.parse(text));
    return Option.match(pickSchemaFile(entries.map((entry) => entry.name)), {
      onNone: () => currentPath,
      onSome: (name) => path.posix.join(dir, name),
    });
  });

const readConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(configPath, 'utf8');
  return yield* decodeConfig(parseYaml(text)).pipe(Effect.mapError((message) => new SchemaSyncError({ message })));
});

const readCurrentSchema = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(schemaPath);
  return exists ? Option.some(yield* fs.readFileString(schemaPath, 'utf8')) : Option.none<string>();
});

const writeConfig = (config: SchemaLock) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.writeFileString(configPath, renderConfig(config)));

const writeSchema = (provenance: Provenance, body: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.writeFileString(schemaPath, renderFile(provenance, body)));

/** Clean generated types and re-run graphql-codegen. */
const regenerateTypes = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* Console.log('↻ regenerating types → src/graphql/generated/');
  yield* fs.remove(generatedDir, { recursive: true, force: true });
  const exitCode = yield* Command.make('graphql-codegen', '--config', 'codegen.ts').pipe(
    Command.workingDirectory(packageDir),
    Command.stdout('inherit'),
    Command.stderr('inherit'),
    Command.exitCode,
  );
  if (exitCode !== 0) {
    return yield* new SchemaSyncError({ message: `graphql-codegen exited with code ${exitCode}` });
  }
});

const runVerify = Effect.gen(function* () {
  const config = yield* readConfig;
  const current = yield* readCurrentSchema;
  const remoteSha = sha256Hex(yield* fetchSchema(config.repo, config.path, config.tag));

  const outcome = decideVerify({
    lockSha: config.sha256,
    // `commit` is not compared; empty is fine.
    expected: { repo: config.repo, tag: config.tag, path: config.path, commit: '', sha256: config.sha256 },
    remoteSha,
    current,
  });

  return yield* VerifyOutcome.$match(outcome, {
    InSync: () => Console.log(`✔ schema in sync — ${config.repo} @ ${config.tag} (${config.sha256.slice(0, 12)}…)`),
    Missing: () =>
      Effect.fail(new SchemaSyncError({ message: 'indexer.gql is missing — run `schema:sync -- --update`' })),
    LockMismatch: ({ remoteSha: r, lockSha }) =>
      Effect.fail(
        new SchemaSyncError({
          message: `upstream content under ${config.tag} changed: remote ${r.slice(0, 12)}… ≠ lock ${lockSha.slice(0, 12)}…`,
        }),
      ),
    BodyDrift: ({ bodySha, lockSha }) =>
      Effect.fail(
        new SchemaSyncError({
          message: `indexer.gql was modified or is stale: body ${bodySha.slice(0, 12)}… ≠ lock ${lockSha.slice(0, 12)}…. Run \`schema:sync -- --update\`.`,
        }),
      ),
    HeaderMismatch: ({ field, expected, actual }) =>
      Effect.fail(
        new SchemaSyncError({
          message: `provenance header ${field} mismatch: expected "${expected}", found "${actual}"`,
        }),
      ),
  });
});

const runUpdate = (command: Extract<SyncCommand, { _tag: 'Update' }>) =>
  Effect.gen(function* () {
    const config = yield* readConfig;
    const tag = Option.getOrElse(command.tag, () => config.tag);

    const shouldDiscover = Option.isSome(command.tag) && Option.isNone(command.path);
    const schemaFilePath = Option.isSome(command.path)
      ? command.path.value
      : shouldDiscover
        ? yield* discoverSchemaPath(config.repo, tag, config.path)
        : config.path;

    yield* Console.log(`Fetching ${config.repo} @ ${tag} — ${schemaFilePath}`);
    const body = yield* fetchSchema(config.repo, schemaFilePath, tag);
    const commit = yield* fetchCommit(config.repo, tag);
    const remoteSha = sha256Hex(body);

    const provenance: Provenance = { repo: config.repo, tag, path: schemaFilePath, commit, sha256: remoteSha };
    const current = yield* readCurrentSchema;
    const outcome = decideUpdate({ remoteSha, expected: provenance, current });

    // The lock is always re-rendered so it stays authoritative; identical fields produce no git diff.
    yield* writeConfig({ repo: config.repo, tag, path: schemaFilePath, sha256: remoteSha });

    return yield* UpdateOutcome.$match(outcome, {
      Noop: () => Console.log(`✔ already in sync — ${config.repo} @ ${tag}`),
      Retarget: ({ fromTag, toTag }) =>
        pipe(
          writeSchema(provenance, stripHeader(Option.getOrElse(current, () => ''))),
          Effect.andThen(
            Console.log(
              `↻ retargeted ${Option.getOrElse(fromTag, () => '(none)')} → ${toTag} — schema content unchanged, header restamped (no type regeneration)`,
            ),
          ),
        ),
      Rewrite: ({ previousSha }) =>
        pipe(
          writeSchema(provenance, body),
          Effect.andThen(
            Console.log(
              Option.isSome(previousSha)
                ? `↻ schema body changed (${previousSha.value.slice(0, 12)}… → ${remoteSha.slice(0, 12)}…)`
                : `↻ wrote new indexer.gql (${remoteSha.slice(0, 12)}…)`,
            ),
          ),
          Effect.andThen(regenerateTypes),
          Effect.andThen(Console.log('Done. Review the diff (schema.lock, indexer.gql, src/graphql/generated/).')),
        ),
    });
  });

const main = Effect.gen(function* () {
  const command = yield* parseArgs(process.argv.slice(2)).pipe(
    Effect.mapError((message) => new SchemaSyncError({ message })),
  );
  yield* SyncCommand.$match(command, {
    Verify: () => runVerify,
    Update: (update) => runUpdate(update),
  });
}).pipe(Effect.provide(Layer.mergeAll(NodeContext.layer, FetchHttpClient.layer)));

NodeRuntime.runMain(main);
