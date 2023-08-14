#!/usr/bin/env node --experimental-specifier-resolution=node

import yargs from 'yargs';
import { checkConnection } from './check-connection';
import { configHelp, loadConfig } from './config';
import { getInitialWalletState } from './config/genesis';
import { runServer } from './run-server';
import { startWithFaucet } from './start-with-faucet';

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
await yargs(process.argv.slice(2))
  .command(
    'help',
    'Prints help',
    () => {},
    () => {
      console.log('Commands: help, start-with-faucet, start, check-connection:');
      console.log('  - help');
      console.log('      Prints help');
      console.log('  - start-with-faucet (default)');
      console.log('      Starts a brand new wallet, and requests initial tokens from faucet');
      console.log('  - start');
      console.log('      Starts wallet server loading specified wallet from given genesis file');
      console.log('  - check-connection');
      console.log('      Loads wallet from genesis file as "start" does,');
      console.log('      and then checks, whether the wallet has connectivity with specified node');
      console.log('\n');
      console.log('Configuration:');
      console.log(configHelp());
    },
  )
  .command(
    'check-connection',
    'Checks connection to node',
    () => {},
    async () => {
      console.log('Checking connection');
      await checkConnection();
    },
  )
  .command(
    'start',
    'Runs the server',
    () => {},
    async () => {
      const config = loadConfig();
      const walletInitialState = getInitialWalletState(config.genesisFilePath, config.wallet);
      if (walletInitialState == null) {
        throw new Error('Initial wallet state could not be found. Please check your config.');
      }
      await runServer(config, walletInitialState);
    },
  )
  .command(
    ['start-with-faucet', '$0'],
    'Runs a brand-new wallet, with initial tokens received from faucet',
    () => {},
    async () => {
      const config = loadConfig();
      await startWithFaucet(config);
    },
  )
  .help('false')
  .demandCommand().argv;
