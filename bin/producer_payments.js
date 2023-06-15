#!/usr/bin/env node
'use strict'

const fs = require('fs')
const yargs = require('yargs')
const logger = require(`${process.mainModule.path}/../src/modules/logger`)
const _ = require('lodash')
const { hideBin } = require('yargs/helpers')

process.env.TZ = 'UTC'

const SKIP_PRODUCERS = ['Island Grown Food Access Program']
const NON_MEMBERS = ['One Willow Farm']

const MEMBER_FEE = 0.03
const MEMBER_NOTE = '3% fee'
const NON_MEMBER_FEE = 0.08
const NON_MEMBER_NOTE = '8% fee'

const LOGIN_URL = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Account/Login'
const PRODUCER_PAYMENT_URL = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Accounting/PicklistPayments'

const LFM_USERNAME = process.env.LFM_USERNAME
const LFM_PASSWORD = process.env.LFM_PASSWORD

const argv = require('yargs/yargs')(hideBin(process.argv))
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
  .argv

switch (argv.verbose) {
  case 0:
    logger.level = 'info'
    break
  case 1:
    logger.level = 'verbose'
    break
  default:
    logger.level = 'debug'
}

async function processProducerFee (name, subperiod, amtPayable, page) {
  let fees = null
  let feeNote = null
  logger.debug(`processProducerFee: ${name} -- ${subperiod} -- ${amtPayable} -- ${NON_MEMBERS.indexOf(name)}`)
  if (NON_MEMBERS.indexOf(name) != -1) {
    fees = -1 * amtPayable * NON_MEMBER_FEE
    feeNote = NON_MEMBER_NOTE
  } else {
    fees = -1 * amtPayable * MEMBER_FEE
    feeNote = MEMBER_NOTE
  }
  logger.verbose(` ${name} (${subperiod}) \$${fees} - "${feeNote}"`)
  logger.debug('    opening modal')
  page.click(`table.sticky-table-header tr td:text("${name}")`)
  await page.fill('#paytoAmount', fees.toString())
  if (fees !== 0) {
    await page.fill('#paytoNote', feeNote)
  }
  await page.click('button:text("Update")')

  // await page.click('a span.uk-icon-plus-circle');
  // await page.selectOption('#paytoProducer', {label: name});
  // await page.selectOption('#paytoSubPeriod', {label: subperiod});
  // await page.fill('#paytoAmount', fees.toString())
  // await page.fill('#paytoNote', feeNote)
  // the button is clicked by lets wait until the model is closed as the
  // underlying network event may not have been triggered; wait for
  // the modal to close.
  // await page.screenshot({ path: 'output/producer_payment_model_' + name + '-1.png' });
  // await page.click('button:text("Create Payment")')
  // if already exists, lets close and put a warning
  // if uk-notify-message uk-notify-message-warning
  //   uk-modal-close uk-close
  await page.waitForSelector('#producerPaymentModal', { state: 'hidden' })
  // await page.screenshot({ path: 'output/producer_payment_model_' + name + '-2.png' });
  logger.debug('    submitting modal')
}

(async () => {
  const os = require('os')
  const path = require('path')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium'))
  const { chromium } = require('playwright')
  const browser = await chromium.launchPersistentContext(userDataDir, { headless: argv.headless, acceptDownloads: true })
  const page = await browser.newPage()

  await page.goto(LOGIN_URL)
  await page.fill('input[name="Email"]', LFM_USERNAME)
  await page.fill('input[name="Password"]', LFM_PASSWORD)
  await page.click('button[type="submit"]')

  await page.goto(PRODUCER_PAYMENT_URL)
  await page.click('#periodId')
  // wait until we have a new period running before calculating the old closed period
  await page.locator('.select-checkbox-list .internal-periodId li:nth-child(3) input').click()

  await page.click('button:text("Actions")')
  await page.click('a:text("Calculate Producer Payments")')
  await page.click('button:text("OK")')

  await page.waitForSelector('.uk-container .sticky-table-header', { state: 'visible' })
  await page.screenshot({ path: 'output/producer_page1.png' })

  // // Bulk update adjustment amount
  // await page.click('#checkAllItems input')
  // await page.click('button:text("Bulk Actions")')
  // await page.click('a:text("Update Adjustment")')
  // await page.fill('#bulkAdjustment', '-3')
  // await page.selectOption('#bulkAdjustmentType', 'percent')
  // await page.click('button:text("Add Adjustment")')

  // // bulk update adjustment note
  // await page.click('#checkAllItems input')
  // await page.click('button:text("Bulk Actions")')
  // await page.click('a:text("Update Note")')
  // await page.fill('#bulkNote', MEMBER_NOTE)
  // await page.click('button:text("Add Note")')

  // for (let i = 0; i < SKIP_PRODUCERS.length; i++) {
  //   let prodName = SKIP_PRODUCERS[i];
  //   page.click("table.sticky-table-header tr td:text('" + prodName + "')")
  //   await page.fill('#paytoAmount', '')
  //   await page.fill('#paytoNote', '')
  //   await page.click('button:text("Update")')
  // }

  // for (let i = 0; i < NON_MEMBERS.length; i++) {
  //   let prodName = NON_MEMBERS[i];
  //   page.click("table.sticky-table-header tr td:text('" + prodName + "')")
  //   await page.fill('#paytoAmount', '')
  //   await page.fill('#paytoNote', '')
  //   await page.click('button:text("Update")')
  // }

  const allProducerNames = await page.locator('table.sticky-table-header tr td:nth-child(1)').allTextContents()
  const allProducerSubPeriods = await page.locator('table.sticky-table-header tr td:nth-child(3)').allTextContents()
  const allProducerAmtsPayable = await page.locator('table.sticky-table-header tr td:nth-child(4)').allTextContents()
  const producerNames = _.chain(allProducerNames).uniq().without(...SKIP_PRODUCERS).value()

  logger.debug('--------------')
  logger.debug(allProducerNames)
  logger.debug(allProducerSubPeriods)
  logger.debug(allProducerAmtsPayable)
  logger.debug(producerNames)
  logger.debug('--------------')

  for (let i = 0; i < producerNames.length; i++) {
    const pn = producerNames[i]
    const locs = _.filter(_.range(allProducerNames.length), (i) => allProducerNames[i] === pn)
    for (let j = 0; j < locs.length; j++) {
      const loc = locs[j]
      const amtPayable = parseFloat(allProducerAmtsPayable[loc].replace('$', '').replace(',', ''))
      const subperiod = allProducerSubPeriods[loc]
      await processProducerFee(pn, subperiod, amtPayable, page)
    }
  }

  browser.close()
  logger.info(`Finished adding fees to ${producerNames.length} producers`)
})()
