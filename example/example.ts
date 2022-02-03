import { Wallet } from 'impl';

Wallet
    .build("a", "b")
    .then((wallet) => wallet.deploy("test", "123"))
