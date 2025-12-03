import { WalletBuilder } from "@midnight-ntwrk/wallet";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
    NetworkId,
    setNetworkId,
    getZswapNetworkId,
    getLedgerNetworkId
} from "@midnight-ntwrk/midnight-js-network-id";
import { createBalancedTx } from "@midnight-ntwrk/midnight-js-types";
import { nativeToken, Transaction } from "@midnight-ntwrk/ledger";
import { Transaction as ZswapTransaction } from "@midnight-ntwrk/zswap";
import { WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline/promises";
import * as Rx from "rxjs";
import { type Wallet } from "@midnight-ntwrk/wallet-api";
import * as bip39 from 'bip39';


// Fix WebSocket for Node.js environment
// @ts-ignore
globalThis.WebSocket = WebSocket;

// Configure for Midnight Testnet
setNetworkId(NetworkId.TestNet);

// Testnet connection endpoints
const TESTNET_CONFIG = {
    indexer: "https://indexer.testnet-02.midnight.network/api/v1/graphql",
    indexerWS: "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws",
    node: "https://rpc.testnet-02.midnight.network",
    proofServer: "https://lace-dev.proof-pub.stg.midnight.tools"
};

const waitForFunds = (wallet: Wallet) =>
    Rx.firstValueFrom(
        wallet.state().pipe(
            Rx.tap((state) => {
                if (state.syncProgress) {
                    console.log(
                        `Sync progress: synced=${state.syncProgress.synced}, sourceGap=${state.syncProgress.lag.sourceGap}, applyGap=${state.syncProgress.lag.applyGap}`
                    );
                }
            }),
            Rx.filter((state) => state.syncProgress?.synced === true),
            Rx.map((s) => s.balances[nativeToken()] ?? 0n),
            Rx.filter((balance) => balance > 0n),
            Rx.tap((balance) => console.log(`Wallet funded with balance: ${balance}`))
        )
    );



async function main() {
    console.log("Midnight Hello World Deployment\n");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        // Ask user if they have an existing wallet seed
        const choice = await rl.question("Do you have a wallet seed? (y/n): ");
        // d05987306d0074de9f270910b8de0c7bfc2f37738ece9f11089d9f49227640d1



        let walletSeed: string;
        if (choice.toLowerCase() === "y" || choice.toLowerCase() === "yes") {
            // Use existing seed
            walletSeed = await rl.question("Enter your 64-character seed: ");
        } else {
            // // Generate new wallet seed
            // const bytes = new Uint8Array(32);
            // // @ts-ignore
            // crypto.getRandomValues(bytes);
            // walletSeed = Array.from(bytes, (b) =>
            //     b.toString(16).padStart(2, "0")
            // ).join("");
            // console.log(`\nSAVE THIS SEED: ${walletSeed}\n`);


            const mnemonic = bip39.generateMnemonic(256);
            console.log(`Generated mnemonic (save this!): ${mnemonic}`);
            const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
            const seedHex = seedBuffer.slice(0, 32).toString('hex');
            console.log(`Derived seed (save this!): ${seedHex}\n`);
            walletSeed = seedHex;
        }
        // Build wallet from seed
        console.log("Building wallet...");
        const wallet = await WalletBuilder.buildFromSeed(
            TESTNET_CONFIG.indexer,
            TESTNET_CONFIG.indexerWS,
            TESTNET_CONFIG.proofServer,
            TESTNET_CONFIG.node,
            walletSeed,
            getZswapNetworkId(),
            "info"
        );

        wallet.start();
        const state = await Rx.firstValueFrom(wallet.state());
        console.log(`Your wallet address is: ${state.address}`);

        let balance = state.balances[nativeToken()] || 0n;

        if (balance === 0n) {
            console.log(`Your wallet balance is: 0`);
            console.log("Visit: https://midnight.network/test-faucet to get some funds.");
            console.log(`Waiting to receive tokens...`);
            balance = await waitForFunds(wallet);
        }

        console.log(`Balance: ${balance}`);


        // Load compiled contract files
        console.log("Loading contract...");
        const contractPath = path.join(process.cwd(), "contracts");
        const contractModulePath = path.join(
            contractPath,
            "managed",
            "hello-world",
            "contract",
            "index.cjs"
        );

        if (!fs.existsSync(contractModulePath)) {
            console.error("Contract not found! Run: npm run compile");
            process.exit(1);
        }

        const HelloWorldModule = await import(contractModulePath);
        const contractInstance = new HelloWorldModule.Contract({});

        // Create wallet provider for transactions
        const walletState = await Rx.firstValueFrom(wallet.state());

        const walletProvider = {
            coinPublicKey: walletState.coinPublicKey,
            encryptionPublicKey: walletState.encryptionPublicKey,
            balanceTx(tx: any, newCoins: any) {
                return wallet
                    .balanceTransaction(
                        ZswapTransaction.deserialize(
                            tx.serialize(getLedgerNetworkId()),
                            getZswapNetworkId()
                        ),
                        newCoins
                    )
                    .then((tx) => wallet.proveTransaction(tx))
                    .then((zswapTx) =>
                        Transaction.deserialize(
                            zswapTx.serialize(getZswapNetworkId()),
                            getLedgerNetworkId()
                        )
                    )
                    .then(createBalancedTx);
            },
            submitTx(tx: any) {
                return wallet.submitTransaction(tx);
            }
        };
        // Configure all required providers
        console.log("Setting up providers...");
        const zkConfigPath = path.join(contractPath, "managed", "hello-world");
        const providers = {
            privateStateProvider: levelPrivateStateProvider({
                privateStateStoreName: "hello-world-state"
            }),
            publicDataProvider: indexerPublicDataProvider(
                TESTNET_CONFIG.indexer,
                TESTNET_CONFIG.indexerWS
            ),
            zkConfigProvider: new NodeZkConfigProvider(zkConfigPath),
            proofProvider: httpClientProofProvider(TESTNET_CONFIG.proofServer),
            walletProvider: walletProvider,
            midnightProvider: walletProvider
        };

        // Deploy contract to blockchain
        console.log("Deploying contract (30-60 seconds)...");

        const deployed = await deployContract(providers, {
            contract: contractInstance,
            privateStateId: "helloWorldState",
            initialPrivateState: {}
        });

        const contractAddress = deployed.deployTxData.public.contractAddress;

        // Save deployment information
        console.log("\nDEPLOYED!");
        console.log(`Contract: ${contractAddress}\n`);

        const info = {
            contractAddress,
            deployedAt: new Date().toISOString()
        };

        fs.writeFileSync("deployment.json", JSON.stringify(info, null, 2));
        console.log("Saved to deployment.json");

        // Close wallet connection
        await wallet.close();
        // Rest of deployment logic follows...
    } catch (error) {
        console.error("Failed:", error);
    } finally {
        rl.close();
    }

}

main().catch(console.error);
