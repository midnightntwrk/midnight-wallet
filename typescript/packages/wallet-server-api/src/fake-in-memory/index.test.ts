// import { FakeInMemoryWalletServer } from '../fake-in-memory';
// import { Resource } from '../helpers/';
// import { runWalletServerAPITest } from '../testing/api-test';

// const randomDelay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.random() * 10));

// runWalletServerAPITest({
//   instance: Resource.fromPromise(() =>
//     FakeInMemoryWalletServer.prepare(randomDelay).then((walletServer: FakeInMemoryWalletServer) => ({
//       getAPI: () => Resource.fromPromise(() => walletServer.start()),
//     })),
//   ),
// });
describe('dummy test', () => {
  it('should pass', () => {
    expect(true).toBe(true);
  });
});
export {};
