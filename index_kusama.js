#!/usr/bin/env node
const { program } = require('commander');
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { spec } = require('@polkadot/types');
const config = require('@w3f/config');
const { Keyring } = require('@polkadot/keyring');

const MAX_HISTORY = 84; // TODO: Replace with max number of stored eras from... where?

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

const claimPayout = async (nodeUrl, cfg) => {

  //
  // set a timeout manually, since ApiPromise won't let us do this
  // if the timeout is reached, kill the process with exitcode 1
  //
  console.log(`Connecting to API for ${nodeUrl}...`);
  let connected;
  setTimeout(() => {
    if (connected) return;
    console.log('Connection timed out');
    process.exit(1);
  }, 10000);

  //
  // initialize the api
  //
  const api = await ApiPromise.create({
    provider: new WsProvider(nodeUrl),
    ...spec,
  });
  console.log('Connected');
  connected = true;

  const keyring = new Keyring({ type: 'sr25519', ss58Format: 2 });
  const claimerPair = keyring.addFromUri(cfg.claimerWallet);

  const activeEra = (await api.query.staking.activeEra()).toJSON().index;
  // console.log(`Era ${activeEra}`);

  const maxBatchedTransactions = 9999;
  const payoutCalls = [];
	sendtx = 0;

  if (cfg.claimList.length > 0) {
    for (let iClaimList = 0; iClaimList < cfg.claimList.length; iClaimList++) {
      console.log(`Processing claim ${iClaimList} for ${cfg.claimList[iClaimList].alias}`);

      currentAddress = cfg.claimList[iClaimList].controllerAddress;
      stashAddress = cfg.claimList[iClaimList].stashAddress;

      //
      // get relevant chain data
      //
      const ledgerPr = await api.query.staking.ledger(currentAddress);
      const ledger = ledgerPr.unwrapOr(null);
      // console.log(ledger);

      if (!ledger) {
          console.log(`No stacking found for address ${currentAddress} - is this a controller address?`)
      }
      else {
        // let lastReward;
        // lastReward = ledger.claimedRewards.pop().toNumber();
        // console.log(`${lastReward} last reward`);
        alreadyClaimed = ledger.claimedRewards.toJSON();
        console.log(`${alreadyClaimed} previously claimed`);

        // let numOfUnclaimedPayouts = activeEra - lastReward - 1;
        // console.log(`${numOfUnclaimedPayouts} unclaimed eras`);
        let numOfUnclaimedPayouts = MAX_HISTORY;
        let start = 1; // start at one to attempt payout for all available eras (avoid missing payouts when one in the middle has already been claimed)
        while (numOfUnclaimedPayouts > 0) {
          let txLimit = numOfUnclaimedPayouts;
          if (numOfUnclaimedPayouts > maxBatchedTransactions) {
            txLimit = maxBatchedTransactions;
          }
          //sendtx = 0;
          for (let itx = start; itx <= txLimit + start - 1; itx++) {
            // const idx = lastReward + itx;
            const idx = activeEra - MAX_HISTORY - 1 + itx;
            if (!alreadyClaimed.includes(idx)) { // if claimed, skip the era BEFORE downloading the era list
              const exposure = await api.query.staking.erasStakersClipped(idx, stashAddress);
              // console.log(`exposure: ${exposure.total.toBn()}`);
              if (exposure.total.toBn() > 0) {
                sendtx = 1;
                console.log(`Adding claim for ${currentAddress}, era ${idx}`);
                payoutCalls.push(api.tx.staking.payoutStakers(stashAddress, idx));
              }
            }
          }
          numOfUnclaimedPayouts -= txLimit;
          start += txLimit;
        }
        console.log(`All payouts have been claimed for ${currentAddress}.`);

      }
    }
  }
  if (sendtx) {
    try {
      console.log('submit tx');
      await api.tx.utility
          .batch(payoutCalls)
          .signAndSend(claimerPair);
    }
    catch (e) {
      console.log(`Could not request claim for ${currentAddress}: ${e}`);
    }
  }

  process.exit(0);
};

program
  .name('edgeware-simple-payouts')
  .option('-c, --config [path]', 'Path to config file.', './config/main.yaml')
  .parse(process.argv);

const programOptions = program.opts();
// Load config file
const cfg = new config.Config().parse(programOptions.config);

// Pick a random WS endpoint in case one of them is down
let url = 'wss://kusama-rpc.polkadot.io';
if (programOptions.url) {
  url = programOptions.url;
}

console.log(`Claiming payout using node at ${url}`);
claimPayout(url, cfg).then(r => console.log(`Return ${r}`))
