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
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  CONFIG_BANNER,
  decideUpdate,
  decideVerify,
  decodeConfig,
  parseArgs,
  parseHeader,
  pickSchemaFile,
  type Provenance,
  renderConfig,
  renderFile,
  renderHeader,
  sha256Hex,
  splitHeader,
  stripHeader,
} from './index.js';

const BODY = 'type Query {\n\thello: String!\n}\n';
const BODY_SHA = sha256Hex(BODY);

const provenance: Provenance = {
  repo: 'midnightntwrk/midnight-indexer',
  tag: 'v4.0.2',
  path: 'indexer-api/graphql/schema-v4.graphql',
  commit: 'd325eafa8f99c961e1e7155d4f2fc413d7e87529',
  sha256: BODY_SHA,
};

const validConfig = {
  repo: 'midnightntwrk/midnight-indexer',
  tag: 'v4.0.2',
  path: 'indexer-api/graphql/schema-v4.graphql',
  sha256: BODY_SHA,
};

describe('decodeConfig', () => {
  it('accepts a well-formed config', () => {
    const result = decodeConfig(validConfig);
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects a non-hex / wrong-length sha256', () => {
    const result = decodeConfig({ ...validConfig, sha256: 'NOTAHASH' });
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects a missing tag', () => {
    const { tag: _tag, ...noTag } = validConfig;
    expect(Either.isLeft(decodeConfig(noTag))).toBe(true);
  });

  it('rejects an empty tag', () => {
    expect(Either.isLeft(decodeConfig({ ...validConfig, tag: '' }))).toBe(true);
  });

  it('rejects a repo that is not owner/repo', () => {
    expect(Either.isLeft(decodeConfig({ ...validConfig, repo: 'not-a-slug' }))).toBe(true);
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 of the empty string (as shasum would produce)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes string and equivalent bytes identically', () => {
    expect(sha256Hex(BODY)).toBe(sha256Hex(Buffer.from(BODY, 'utf8')));
  });
});

describe('provenance header', () => {
  it('round-trips render -> parse', () => {
    const parsed = parseHeader(renderFile(provenance, BODY));
    expect(Option.getOrThrow(parsed)).toEqual(provenance);
  });

  it('splitHeader separates our header from the body', () => {
    const { header, body } = splitHeader(renderFile(provenance, BODY));
    expect(Option.isSome(header)).toBe(true);
    expect(body).toBe(BODY);
  });

  it('stripHeader returns the body verbatim so its hash equals the lock', () => {
    expect(sha256Hex(stripHeader(renderFile(provenance, BODY)))).toBe(BODY_SHA);
  });

  it('treats a headerless file (body starting with """) as all-body', () => {
    const headerless = '"""\ndesc\n"""\ntype Query { hello: String! }\n';
    const { header, body } = splitHeader(headerless);
    expect(Option.isNone(header)).toBe(true);
    expect(body).toBe(headerless);
  });

  it('parseHeader returns none for a recognized header missing a field', () => {
    // has the sentinel (so it is "ours") but no `source:` line → not fully parseable
    const brokenHeader = renderFile(provenance, BODY).replace(/^# source:.*$/m, '# (source removed)');
    expect(Option.isNone(parseHeader(brokenHeader))).toBe(true);
  });

  it('renderHeader ends with a blank separator line before the body', () => {
    expect(renderHeader(provenance).endsWith('\n\n')).toBe(true);
  });
});

describe('renderConfig', () => {
  it('emits the managed banner and groups source (repo/path) before lock (tag/sha256)', () => {
    const yaml = renderConfig(validConfig);
    expect(yaml.startsWith(CONFIG_BANNER)).toBe(true);
    expect(yaml).toContain('tag: v4.0.2');
    expect(yaml).toContain(`sha256: ${BODY_SHA}`);
    // source group first (repo, path), then lock group (tag, sha256)
    expect(yaml.indexOf('repo:')).toBeLessThan(yaml.indexOf('path:'));
    expect(yaml.indexOf('path:')).toBeLessThan(yaml.indexOf('tag:'));
    expect(yaml.indexOf('tag:')).toBeLessThan(yaml.indexOf('sha256:'));
  });

  it('renders valid YAML that decodes back to the config (comments and all)', () => {
    const decoded = decodeConfig(parseYaml(renderConfig(validConfig)));
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) expect(decoded.right).toEqual(validConfig);
  });
});

describe('parseArgs', () => {
  const right = <A>(e: Either.Either<A, string>): A => Either.getOrThrowWith(e, (msg) => new Error(msg));

  it('defaults to verify with no args', () => {
    expect(right(parseArgs([]))._tag).toBe('Verify');
  });

  it('parses --update as an update with no tag', () => {
    const cmd = right(parseArgs(['--update']));
    expect(cmd._tag).toBe('Update');
    if (cmd._tag === 'Update') expect(Option.isNone(cmd.tag)).toBe(true);
  });

  it('parses --tag v4.3.3 (space form) as update with that tag', () => {
    const cmd = right(parseArgs(['--tag', 'v4.3.3']));
    expect(cmd._tag).toBe('Update');
    if (cmd._tag === 'Update') expect(Option.getOrNull(cmd.tag)).toBe('v4.3.3');
  });

  it('parses --tag=v4.3.3 (equals form)', () => {
    const cmd = right(parseArgs(['--tag=v4.3.3']));
    if (cmd._tag === 'Update') expect(Option.getOrNull(cmd.tag)).toBe('v4.3.3');
  });

  it('parses --path override alongside --tag', () => {
    const cmd = right(parseArgs(['--tag', 'v5.0.0', '--path', 'a/b/schema-v5.graphql']));
    if (cmd._tag === 'Update') expect(Option.getOrNull(cmd.path)).toBe('a/b/schema-v5.graphql');
  });

  it('rejects a --tag with no value', () => {
    expect(Either.isLeft(parseArgs(['--tag']))).toBe(true);
  });

  it('rejects an empty inline value (--tag=)', () => {
    expect(Either.isLeft(parseArgs(['--tag=']))).toBe(true);
  });

  it('rejects unknown arguments', () => {
    expect(Either.isLeft(parseArgs(['--frobnicate']))).toBe(true);
  });
});

describe('pickSchemaFile', () => {
  it('picks the highest schema-vN.graphql', () => {
    expect(Option.getOrNull(pickSchemaFile(['schema-v1.graphql', 'schema-v4.graphql', 'schema-v3.graphql']))).toBe(
      'schema-v4.graphql',
    );
  });

  it('ignores non-matching files', () => {
    expect(Option.getOrNull(pickSchemaFile(['README.md', 'schema-v2.graphql', 'notes.txt']))).toBe('schema-v2.graphql');
  });

  it('returns none when there is no schema file', () => {
    expect(Option.isNone(pickSchemaFile(['README.md']))).toBe(true);
  });
});

describe('decideVerify', () => {
  const inSyncFile = renderFile(provenance, BODY);

  it('passes when remote, body and header all match the lock', () => {
    const outcome = decideVerify({
      lockSha: BODY_SHA,
      expected: provenance,
      remoteSha: BODY_SHA,
      current: Option.some(inSyncFile),
    });
    expect(outcome._tag).toBe('InSync');
  });

  it('flags LockMismatch when upstream mutated under the tag', () => {
    const outcome = decideVerify({
      lockSha: BODY_SHA,
      expected: provenance,
      remoteSha: 'f'.repeat(64),
      current: Option.some(inSyncFile),
    });
    expect(outcome._tag).toBe('LockMismatch');
  });

  it('flags Missing when the file is absent', () => {
    const outcome = decideVerify({
      lockSha: BODY_SHA,
      expected: provenance,
      remoteSha: BODY_SHA,
      current: Option.none(),
    });
    expect(outcome._tag).toBe('Missing');
  });

  it('flags BodyDrift when the on-disk body was hand-edited', () => {
    const edited = renderFile(provenance, BODY + '\n# sneaky edit\n');
    const outcome = decideVerify({
      lockSha: BODY_SHA,
      expected: provenance,
      remoteSha: BODY_SHA,
      current: Option.some(edited),
    });
    expect(outcome._tag).toBe('BodyDrift');
  });

  it('flags HeaderMismatch when the header names a different tag', () => {
    const staleHeader = renderFile({ ...provenance, tag: 'v3.9.9' }, BODY);
    const outcome = decideVerify({
      lockSha: BODY_SHA,
      expected: provenance,
      remoteSha: BODY_SHA,
      current: Option.some(staleHeader),
    });
    expect(outcome._tag).toBe('HeaderMismatch');
  });

  it('flags HeaderMismatch when the provenance header is missing entirely', () => {
    // body matches the lock but the file has no header (someone stripped it)
    const outcome = decideVerify({
      lockSha: BODY_SHA,
      expected: provenance,
      remoteSha: BODY_SHA,
      current: Option.some(BODY),
    });
    expect(outcome._tag).toBe('HeaderMismatch');
  });
});

describe('decideUpdate', () => {
  it('rewrites when there is no current file', () => {
    const outcome = decideUpdate({
      remoteSha: BODY_SHA,
      expected: provenance,
      current: Option.none(),
    });
    expect(outcome._tag).toBe('Rewrite');
  });

  it('rewrites when the body content changed', () => {
    const outcome = decideUpdate({
      remoteSha: 'a'.repeat(64),
      expected: { ...provenance, sha256: 'a'.repeat(64) },
      current: Option.some(renderFile(provenance, BODY)),
    });
    expect(outcome._tag).toBe('Rewrite');
  });

  it('is a no-op when body and header already match', () => {
    const outcome = decideUpdate({
      remoteSha: BODY_SHA,
      expected: provenance,
      current: Option.some(renderFile(provenance, BODY)),
    });
    expect(outcome._tag).toBe('Noop');
  });

  it('retargets (header only) when body is identical but the tag changed', () => {
    // e.g. v4.0.0 -> v4.0.2: identical bytes, only the version label moves
    const previous = renderFile({ ...provenance, tag: 'v4.0.0' }, BODY);
    const outcome = decideUpdate({
      remoteSha: BODY_SHA,
      expected: { ...provenance, tag: 'v4.0.2' },
      current: Option.some(previous),
    });
    expect(outcome._tag).toBe('Retarget');
    if (outcome._tag === 'Retarget') {
      expect(Option.getOrNull(outcome.fromTag)).toBe('v4.0.0');
      expect(outcome.toTag).toBe('v4.0.2');
    }
  });
});
