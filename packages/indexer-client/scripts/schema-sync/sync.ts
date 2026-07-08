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
// `./lib`. It reads two files: schema.config.yml (editable source: repo + path)
// and schema.lock (tool-owned: tag + sha256), and only ever writes the lock.
// Run from the repo root:
//
//   yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client                 # verify (default)
//   yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client -- --tag v4.3.3 # pin a version
//   yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client -- --update     # re-apply the pin
//
// See ./README.md for the full behaviour matrix.
//

import { Console, Data, Effect, Layer, Option, pipe } from 'effect';
import { Command, FetchHttpClient, FileSystem, HttpClient, HttpClientRequest } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  type Provenance,
  type SchemaConfig,
  type SchemaLock,
  SyncCommand,
  UpdateOutcome,
  VerifyOutcome,
  decideUpdate,
  decideVerify,
  decodeConfig,
  decodeLock,
  parseArgs,
  renderFile,
  renderLock,
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
const configPath = path.join(packageDir, 'schema.config.yml');
const lockPath = path.join(packageDir, 'schema.lock');
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

/** Fetch the schema file's bytes as text. */
const fetchSchema = (repo: string, filePath: string, tag: string) =>
  fetchText(contentsUrl(repo, filePath, tag), 'application/vnd.github.raw');

/** Resolve the commit SHA a tag points to (informational provenance). */
const fetchCommit = (repo: string, tag: string) =>
  fetchText(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(tag)}`,
    'application/vnd.github.sha',
  ).pipe(Effect.map((sha) => sha.trim()));

const readConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(configPath, 'utf8');
  return yield* decodeConfig(parseYaml(text)).pipe(Effect.mapError((message) => new SchemaSyncError({ message })));
});

const readLock = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(lockPath))) return Option.none<SchemaLock>();
  const text = yield* fs.readFileString(lockPath, 'utf8');
  return Option.some(
    yield* decodeLock(parseYaml(text)).pipe(Effect.mapError((message) => new SchemaSyncError({ message }))),
  );
});

const readCurrentSchema = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(schemaPath);
  return exists ? Option.some(yield* fs.readFileString(schemaPath, 'utf8')) : Option.none<string>();
});

const writeLock = (lock: SchemaLock) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.writeFileString(lockPath, renderLock(lock)));

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

/** The provenance a committed `indexer.gql` should carry, from the resolved source + version. */
const provenanceOf = (config: SchemaConfig, tag: string, commit: string, sha256: string): Provenance => ({
  repo: config.repo,
  tag,
  path: config.path,
  commit,
  sha256,
});

const runVerify = Effect.gen(function* () {
  const config = yield* readConfig;
  const lock = yield* readLock;
  if (Option.isNone(lock)) {
    return yield* new SchemaSyncError({ message: 'schema.lock is missing — run `schema:sync -- --tag <version>`' });
  }
  const { tag, sha256 } = lock.value;
  const current = yield* readCurrentSchema;
  const remoteSha = sha256Hex(yield* fetchSchema(config.repo, config.path, tag));

  const outcome = decideVerify({
    lockSha: sha256,
    // `commit` is not compared; empty is fine.
    expected: provenanceOf(config, tag, '', sha256),
    remoteSha,
    current,
  });

  return yield* VerifyOutcome.$match(outcome, {
    InSync: () => Console.log(`✔ schema in sync — ${config.repo} @ ${tag} (${sha256.slice(0, 12)}…)`),
    Missing: () =>
      Effect.fail(new SchemaSyncError({ message: 'indexer.gql is missing — run `schema:sync -- --update`' })),
    LockMismatch: ({ remoteSha: r, lockSha }) =>
      Effect.fail(
        new SchemaSyncError({
          message: `upstream content under ${tag} changed: remote ${r.slice(0, 12)}… ≠ lock ${lockSha.slice(0, 12)}…`,
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
    const lock = yield* readLock;

    // Version to apply: --tag wins, else the currently-pinned tag, else there is nothing to pin.
    const tag = yield* Option.match(command.tag, {
      onSome: (t) => Effect.succeed(t),
      onNone: () =>
        Option.match(lock, {
          onSome: (l) => Effect.succeed(l.tag),
          onNone: () => new SchemaSyncError({ message: 'no tag pinned in schema.lock — pass `--tag <version>`' }),
        }),
    });

    yield* Console.log(`Fetching ${config.repo} @ ${tag} — ${config.path}`);
    const body = yield* fetchSchema(config.repo, config.path, tag);
    const commit = yield* fetchCommit(config.repo, tag);
    const remoteSha = sha256Hex(body);

    const provenance = provenanceOf(config, tag, commit, remoteSha);
    const current = yield* readCurrentSchema;
    const outcome = decideUpdate({ remoteSha, expected: provenance, current });

    // The lock is always re-rendered so it stays authoritative; identical values produce no git diff.
    yield* writeLock({ tag, sha256: remoteSha });

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
