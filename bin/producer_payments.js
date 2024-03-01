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
  .option('periodDate', {
    alias: 'p',
    description: 'which period date, as displayed, to run'
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

async function processProducerFee (name, subperiod, amtPayable, location, page) {
  let fees = null
  let feeNote = null
  logger.debug(`processProducerFee: ${name} -- ${subperiod} -- ${amtPayable} -- location: ${location} -- non-member? ${NON_MEMBERS.indexOf(name) != -1}`)
  if (NON_MEMBERS.indexOf(name) != -1) {
    fees = -1 * amtPayable * NON_MEMBER_FEE
    feeNote = NON_MEMBER_NOTE
  } else {
    fees = -1 * amtPayable * MEMBER_FEE
    feeNote = MEMBER_NOTE
  }
  logger.verbose(` ${name} (${subperiod}) \$${fees} - "${feeNote}"`)
  logger.debug('    opening modal')
  page.locator(`table.sticky-table-header tr`).nth(location+1).locator(`td:text("${name}")`).click()
  await page.fill('#paytoAmount', fees.toString())
  if (fees !== 0) {
    await page.fill('#paytoNote', feeNote)
  }
  // await page.screenshot({ path: 'output/producer_payment_model_' + name + '_' + subperiod + '-2.png' });
  await page.click('button:text("Update")')
  await page.waitForSelector('#producerPaymentModal', { state: 'hidden' })
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
  logger.debug(`periodDate: '${argv.periodDate}'`)
  if (argv.periodDate) {
    logger.debug(`selecting date: ${argv.periodDate}`)
    await page.locator(`.select-checkbox-list li.select-checkbox-option :text("${argv.periodDate}")`).click()
  }else{
    // wait until we have a new period running before calculating the old closed period
    await page.locator('.select-checkbox-list .internal-periodId li:nth-child(3) input').click()
  }

  await page.click('button:text("Actions")')
  await page.click('a:text("Calculate Producer Payments")')
  await page.click('button:text("OK")')

  await page.waitForSelector('.uk-container .sticky-table-header', { state: 'visible' })
  // await page.screenshot({ path: 'output/producer_page1.png' })

  const periodDate = await page.locator('.select-checkbox-list .internal-periodId .select-checkbox-placeholder').allTextContents()
  const allProducerNames = await page.locator('table.sticky-table-header tr td:nth-child(1)').allTextContents()
  const allProducerSubPeriods = await page.locator('table.sticky-table-header tr td:nth-child(3)').allTextContents()
  const allProducerAmtsPayable = await page.locator('table.sticky-table-header tr td:nth-child(4)').allTextContents()
  const uniqProducerNames = _.chain(allProducerNames).uniq().without(...SKIP_PRODUCERS).value()

  logger.debug(periodDate)
  logger.debug(allProducerNames)
  logger.debug(allProducerSubPeriods)
  logger.debug(allProducerAmtsPayable)

  for (let loc = 0; loc < allProducerNames.length; loc++) {
    const pn = allProducerNames[loc]
    //ie, if producer is not on the skip list
    // do this here rather than use producerNames so we can keep the location tied to
    // the producer AND sub-period
    if (SKIP_PRODUCERS.indexOf(pn) < 0){
      const amtPayable = parseFloat(allProducerAmtsPayable[loc].replace('$', '').replace(',', ''))
      const subperiod = allProducerSubPeriods[loc]
      await processProducerFee(pn, subperiod, amtPayable, loc, page)
    }
  }

  browser.close()
  logger.info(`Finished adding fees to ${uniqProducerNames.length} producers`)
})()
