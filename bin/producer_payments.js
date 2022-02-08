#!/usr/bin/env node
'use strict';

const fs     = require('fs');
const yargs  = require('yargs');
const logger = require(`${process.mainModule.path}/../src/modules/logger`);
const _      = require('lodash');
const { hideBin } = require('yargs/helpers');

process.env.TZ = 'UTC';


const SKIP_PRODUCERS = ['San Juan County HCS']
const NON_MEMBERS    = ['One Willow Farm']

const MEMBER_FEE = 0.03
const MEMBER_NOTE = '3% fee'
const NON_MEMBER_FEE = 0.08
const NON_MEMBER_NOTE = '8% fee'

const LOGIN_URL            = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Account/Login';
const PRODUCER_PAYMENT_URL = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Accounting/ProducerPayments';

const LFM_USERNAME = process.env.LFM_USERNAME;
const LFM_PASSWORD = process.env.LFM_PASSWORD;



var argv = require('yargs/yargs')(hideBin(process.argv))
    .usage('Usage: $0 -o [file path]')
    .option('headless', {
        description: 'run in headless mode',
        type: 'boolean',
        default: false
    })
    .count('verbose')
    .alias('v', 'verbose')
    .demandOption([])
    .help()
    .alias('help', 'h')
    .argv;

  switch(argv.verbose) {
    case 0:
      logger.level = 'info';
      break;
    case 1:
      logger.level = 'verbose';
      break;
    default:
      logger.level = 'debug';
    }


async function processProducerFee(name, subperiod, amtPayable, page){
  var fees = null;
  var feeNote = null;
  logger.debug(`processProducerFee: ${name} -- ${subperiod} -- ${amtPayable} -- ${page} -- ${NON_MEMBERS.indexOf(name)}`)
  if(NON_MEMBERS.indexOf(name) != -1){
    fees = -1 * amtPayable * NON_MEMBER_FEE;
    feeNote = NON_MEMBER_NOTE;
  }else{
    fees = -1 * amtPayable * MEMBER_FEE;
    feeNote = MEMBER_NOTE;
  }
  logger.verbose(` ${name} (${subperiod}) \$${fees} - "${feeNote}"`);
  logger.debug("    opening modal")
  await page.click('a span.uk-icon-plus-circle');
  await page.selectOption('#paytoProducer', {label: name});
  await page.selectOption('#paytoSubPeriod', {label: subperiod});
  await page.fill('#paytoAmount', fees.toString())
  await page.fill('#paytoNote', feeNote)
  // the button is clicked by lets wait until the model is closed as the
  // underlying network event may not have been triggered; wait for
  // the modal to close.
  await page.screenshot({ path: `output/producer_payment_model_#{name}-1.png` });
  await page.click('button:text("Create Payment")')
  // if already exists, lets close and put a warning
  // if uk-notify-message uk-notify-message-warning
  //   uk-modal-close uk-close
  await page.waitForSelector('#producerPaymentModal', {state: 'hidden'})
  await page.screenshot({ path: `output/producer_payment_model_#{name}-2.png` });
  logger.debug("    submitting modal")
  return;
}


(async () => {
  const os   = require('os');
  const path = require('path');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium'));
  const { chromium } = require('playwright');
  const browser = await chromium.launchPersistentContext(userDataDir, { headless: argv.headless, acceptDownloads: true });
  const page    = await browser.newPage();

  await page.goto(LOGIN_URL);

  await page.fill('input[name="Email"]', LFM_USERNAME);
  await page.fill('input[name="Password"]', LFM_PASSWORD);
  await page.click('button[type="submit"]');

  await page.goto(PRODUCER_PAYMENT_URL)
  await page.screenshot({ path: `output/producer_page1.png` });
  // wait until we have a new period running before calculating the old closed period
  await page.check('input[name="showPaymentsBySubPeriod"]');
  await page.click('button:text("Calculate Producer Payments")')
  await page.selectOption('#periodId', {index: 2});
  await page.screenshot({ path: `output/producer_page2.png` });

  const allProducerNames       = await page.locator('table.sticky-table-header tr td:nth-child(2)').allTextContents()
  const allProducerSubPeriods  = await page.locator('table.sticky-table-header tr td:nth-child(3)').allTextContents()
  const allProducerAmtsPayable = await page.locator('table.sticky-table-header tr td:nth-child(4)').allTextContents()
  const producerNames = _.chain(allProducerNames).uniq().without(...SKIP_PRODUCERS).value()

  console.log('--------------')
  console.log(allProducerNames)
  console.log(allProducerSubPeriods)
  console.log(allProducerAmtsPayable)
  console.log(producerNames)
  console.log('--------------')

  for (let i = 0; i < producerNames.length; i++) {
    let pn = producerNames[i];
    let locs = _.filter(_.range(allProducerNames.length), (i) => allProducerNames[i] === pn);
    for (let j = 0; j < locs.length; j++) {
      let loc = locs[j];
      let amtPayable = parseFloat(allProducerAmtsPayable[loc].replace('$', '').replace(',', ''));
      let subperiod = allProducerSubPeriods[loc];
      await processProducerFee(pn, subperiod, amtPayable, page);
    }
  }

  browser.close();
  logger.info(`Finished adding fees to ${producerNames.length} producers`)
})();

