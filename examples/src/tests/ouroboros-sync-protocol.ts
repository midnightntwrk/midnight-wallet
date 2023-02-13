import {
  Decoder,
  DecodingResult,
  OuroborosSyncService,
  OuroborosSyncServiceBuilder,
  Show,
} from '@midnight/ouroboros-sync-mini-protocol';

import * as E from 'fp-ts/Either';
import * as t from 'io-ts';

const BlockCodec = t.type({
  header: t.type({
    hash: t.string,
  }),
});

export type Block = t.TypeOf<typeof BlockCodec>;

const decoder: Decoder<Block> = {
  decode(obj): DecodingResult<Block> {
    const tx = BlockCodec.decode(obj);
    if (E.isLeft(tx)) return { message: "Can't decode tx." };
    return { value: tx.right };
  },
};

const show: Show<Block> = {
  show(block: Block): string {
    return `${block.header.hash}`;
  },
};

export async function createOuroborosSyncService(
  nodeHost: string,
  nodePort: number,
): Promise<OuroborosSyncService<Block>> {
  return await OuroborosSyncServiceBuilder.build<Block>(
    `ws://${nodeHost}:${nodePort}`,
    decoder,
    show,
  );
}
