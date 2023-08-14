import * as t from 'io-ts';

export const MessageTypes = {
  submitTxRequest: 'submitTxRequest',
  submitTxResponse: 'submitTxResponse',
  calculateTxCostRequest: 'calculateTxCostRequest',
  calculateTxCostResponse: 'calculateTxCostResponse',
  state: 'state',
  stateRequest: 'stateRequest',
  stateResponse: 'stateResponse',
  updateTxStateRequest: 'updateTxStateRequest',
  updateTxStateResponse: 'updateTxStateResponse',
} as const;

export const ServerRequestsCodec = t.union([
  t.literal(MessageTypes.submitTxRequest),
  t.literal(MessageTypes.calculateTxCostRequest),
  t.literal(MessageTypes.stateRequest),
  t.literal(MessageTypes.updateTxStateRequest),
]);
export type ServerRequest = t.TypeOf<typeof ServerRequestsCodec>;

export const ServerResponsesCodec = t.union([
  t.literal(MessageTypes.submitTxResponse),
  t.literal(MessageTypes.calculateTxCostResponse),
  t.literal(MessageTypes.state),
  t.literal(MessageTypes.stateRequest),
  t.literal(MessageTypes.stateResponse),
  t.literal(MessageTypes.updateTxStateResponse),
]);
export type ServerResponse = t.TypeOf<typeof ServerResponsesCodec>;

export const ServerRequestIdCodec = t.string;
export type ServerRequestId = t.TypeOf<typeof ServerRequestIdCodec>;

export const TxRequestStates = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  failed: 'failed',
} as const;

export const TxRequestStatesCodec = t.union([
  t.literal(TxRequestStates.pending),
  t.literal(TxRequestStates.approved),
  t.literal(TxRequestStates.rejected),
  t.literal(TxRequestStates.failed),
]);
export type TxRequestState = t.TypeOf<typeof TxRequestStatesCodec>;

export const BigIntCodec = new t.Type<bigint, string, unknown>(
  'bigint',
  (value): value is bigint => typeof value === 'bigint',
  (value, context) =>
    typeof value === 'string' && typeof BigInt(value) === 'bigint'
      ? t.success(BigInt(value))
      : t.failure(value, context, 'Expected string to be a bigint'),
  (value) => value.toString(),
);

export const TransactionFeeCodec = BigIntCodec;
export type TransactionFee = t.TypeOf<typeof TransactionFeeCodec>;
export const BalanceCodec = BigIntCodec;
export type Balance = t.TypeOf<typeof BalanceCodec>;

const FailRejectStateCodec = t.union([
  t.intersection([
    t.type({
      state: t.literal(TxRequestStates.failed),
    }),
    t.partial({
      reason: t.union([t.string, t.undefined]),
    }),
  ]),
  t.intersection([
    t.type({
      state: t.literal(TxRequestStates.rejected),
    }),
    t.partial({
      reason: t.union([t.string, t.undefined]),
    }),
  ]),
]);

const mkResponsePayloadCodec = <T>(approvedStatePayload: t.Type<T, unknown, any>) => {
  return t.intersection([
    t.type({
      id: ServerRequestIdCodec,
    }),
    t.union([
      t.intersection([
        t.type({
          state: t.literal(TxRequestStates.approved),
        }),
        approvedStatePayload,
      ]),
      t.type({
        state: t.literal(TxRequestStates.pending),
      }),
      FailRejectStateCodec,
    ]),
  ]);
};

export const UpdateTxStateRequestCodec = t.type({
  type: t.literal(MessageTypes.updateTxStateRequest),
  payload: t.type({
    id: ServerRequestIdCodec,
    state: TxRequestStatesCodec,
  }),
});

export type UpdateTxStateRequest = t.TypeOf<typeof UpdateTxStateRequestCodec>;

export const UpdateTxStateResponseCodec = t.type({
  type: t.literal(MessageTypes.updateTxStateResponse),
  payload: t.type({
    id: ServerRequestIdCodec,
    updated: t.boolean,
  }),
});

export type UpdateTxStateResponse = t.TypeOf<typeof UpdateTxStateResponseCodec>;

export const mkCalculateTxCostRequestCodec = <T>(transactionCodec: t.Type<T, string, unknown>) =>
  t.type({
    type: t.literal(MessageTypes.calculateTxCostRequest),
    payload: t.type({
      transaction: transactionCodec,
    }),
  });

export const CalculateTxCostResponseCodec = t.type({
  type: t.literal(MessageTypes.calculateTxCostResponse),
  payload: mkResponsePayloadCodec(
    t.type({
      estimatedCost: BigIntCodec,
    }),
  ),
});

export type CalculateTxCostResponse = t.TypeOf<typeof CalculateTxCostResponseCodec>;

export const mkSubmitTxRequestCodec = <T, Y>(
  transactionCodec: t.Type<T, string, unknown>,
  coinInfoCodec: t.Type<Y, string, unknown>,
) =>
  t.type({
    type: t.literal(MessageTypes.submitTxRequest),
    payload: t.type({
      transaction: transactionCodec,
      newCoins: t.array(coinInfoCodec),
    }),
  });

export const mkSubmitTxResponseCodec = <T>(txIdentifierCodec: t.Type<T, string, unknown>) =>
  t.type({
    type: t.literal(MessageTypes.submitTxResponse),
    payload: mkResponsePayloadCodec(
      t.type({
        txIdentifier: txIdentifierCodec,
      }),
    ),
  });

export const mkStateMessageCodec = <T>(addressCodec: t.Type<T, string, unknown>) =>
  t.type({
    type: t.literal(MessageTypes.state),
    payload: t.type({
      address: addressCodec,
      balance: BalanceCodec,
    }),
  });

export const StateRequestCodec = t.type({
  type: t.literal(MessageTypes.stateRequest),
});

export type StateRequest = t.TypeOf<typeof StateRequestCodec>;

export const mkStateResponseCodec = <T>(addressCodec: t.Type<T, string, unknown>) =>
  t.type({
    type: t.literal(MessageTypes.stateResponse),
    payload: t.type({
      address: addressCodec,
      balance: BalanceCodec,
    }),
  });

export const mkSubmitTxRequestWithFeeCodec = <T, Y>(
  transactionCodec: t.Type<T, string, unknown>,
  coinInfoCodec: t.Type<Y, string, unknown>,
) =>
  t.intersection([
    mkSubmitTxRequestCodec(transactionCodec, coinInfoCodec),
    t.type({
      payload: t.type({
        fee: TransactionFeeCodec,
      }),
    }),
  ]);

export const ErrorOutputMessageType = 'error';

export const ErrorOutputMessageCodec = t.type({
  type: t.literal(ErrorOutputMessageType),
  payload: t.type({
    id: t.union([ServerRequestIdCodec, t.undefined]),
    message: t.string,
  }),
});
export type ErrorOutputMessage = t.TypeOf<typeof ErrorOutputMessageCodec>;

/* Wallet Server Inputs/Outputs */
export const mkServerInputMessageCodec = <T, Y>(
  transactionCodec: t.Type<T, string, unknown>,
  coinInfoCodec: t.Type<Y, string, unknown>,
) =>
  t.union([
    mkSubmitTxRequestCodec(transactionCodec, coinInfoCodec),
    mkCalculateTxCostRequestCodec(transactionCodec),
    StateRequestCodec,
    UpdateTxStateRequestCodec,
  ]);

export const mkServerOutputMessageCodec = <T, Y>(
  addressCodec: t.Type<T, string, unknown>,
  txIdentifierCodec: t.Type<Y, string, unknown>,
) =>
  t.union([
    mkSubmitTxResponseCodec(txIdentifierCodec),
    mkStateResponseCodec(addressCodec),
    CalculateTxCostResponseCodec,
    ErrorOutputMessageCodec,
    UpdateTxStateResponseCodec,
  ]);
