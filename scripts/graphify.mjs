#!/usr/bin/env node
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
// @ts-check
import { spawnSync } from 'node:child_process';

// Thin wrapper around the optional graphify knowledge-graph tool (AST-only, no
// LLM/API cost). graphify is a personal/optional dev tool, so a missing install
// is a friendly skip, not a hard failure. Modes:
//   (default)  graphify update .           one-shot rebuild
//   --force    graphify update . --force   overwrite even with fewer nodes (post-refactor)
//   --watch    graphify watch .            continuous rebuild while editing
const argv = process.argv.slice(2);
const watch = argv.includes('--watch');
const force = argv.includes('--force');
const args = watch ? ['watch', '.'] : ['update', '.', ...(force ? ['--force'] : [])];

const result = spawnSync('graphify', args, { stdio: 'inherit', shell: false });

if (result.error?.code === 'ENOENT') {
  console.error(
    '\ngraphify is not installed or not on PATH — skipping.\n\n' +
      'graphify is optional: building, testing, and contributing never require it.\n\n' +
      'In a Claude Code session the skill will try to install graphify for you, but\n' +
      'that install is bare — it omits watchdog, so `yarn graphify:watch` will not\n' +
      'work. A manual install is preferred because you can add `--with watchdog`\n' +
      '(requires uv — https://docs.astral.sh/uv/):\n' +
      '  uv tool install graphifyy --with watchdog\n' +
      'then re-run this command. See CLAUDE_GUIDE.md — otherwise, ignore this.\n',
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
