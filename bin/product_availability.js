#!/usr/bin/env node
'use strict';

const fs     = require('fs');
const yargs  = require('yargs');
const logger = require(`${process.mainModule.path}/../src/modules/logger`);
const _      = require('lodash');
const { hideBin } = require('yargs/helpers');

// const stayAwake = require('stay-awake');
// stayAwake.prevent(function() {});
require("dotenv").config();

process.env.TZ = 'UTC';

const LOGIN_URL                = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Account/Login';
const PRODUCT_AVAILABILITY_URL = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Home/AdminAvailability';
const ORDERS_ID_START          = 10000
const ORDERS_URL               = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Order/Index'

const LFM_USERNAME = process.env.LFM_USERNAME;
const LFM_PASSWORD = process.env.LFM_PASSWORD;

const SKIP_CATEGORIES = ['Community Support']

const collapseARecords = true

const fetchDelay = 0.5 * 1000
const longDelay  = 5 * 1000
const pauseCounterLimit = 200

const os   = require('os');
const path = require('path');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium'));
const playwright = require('playwright');

var argv = require('yargs/yargs')(hideBin(process.argv))
    .usage('Usage: $0 -o [file path]')
    // .positional('output_file', {
    //     describe: 'port to bind on',
    //     default: 5000
    // })
    .option('headless', {
        description: 'run in headless mode',
        type: 'boolean',
        default: false
    })
    .option('start_at', {
        alias: 's',
        description: 'which order number to start at',
        default: ORDERS_ID_START
    })
    .option('continue', {
        alias: 'c',
        description: 'pick up where previous run left off',
        type: 'boolean',
        default: false
    })
    .option('num_orders', {
        alias: 'n',
        description: 'number of orders to retrieve',
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


(async () => {
  const browser = await playwright.chromium.launchPersistentContext(userDataDir, { headless: false, acceptDownloads: false });
  const page    = await browser.newPage();

  await loginLFM(page)

  await retrieveOrderData(page)
  // await retrieveProductAvailabilityData(page)

  browser.close();
  stayAwake.allow(function() {});
})();


const loginLFM = async (page) => {
  await page.goto(LOGIN_URL);

  await page.fill('input[name="Email"]', LFM_USERNAME);
  await page.fill('input[name="Password"]', LFM_PASSWORD);
  await page.click('button[type="submit"]');
}


const retrieveOrderData = async (page) => {
  const filename = "orders.csv";
  const fileFlag = argv.continue ? 'a' : 'w'
  //if starts_at isn't different, we're continuing, AND the previous file exists..
  if(argv.continue && fs.existsSync(filename)) {
    const readLastLines = require('read-last-lines');
    let lastLine
    await readLastLines.read(filename, 1)
      .then((lines) => lastLine = lines);
    let lastIdFound = parseInt(lastLine.split(',')[0])
    if(argv.start_at < lastIdFound) argv.start_at = lastIdFound+1
    logger.info(`picking up at order ID ${argv.start_at}`)
  }
  // const file = await fs.open(filename, fileFlag);
  const writableStream = fs.createWriteStream(filename, {flags: fileFlag});
  const csvHeaders = [
    {id: 'orderId', title: 'orderId'},
    {id: 'orderDate', title: 'orderDate'},
    {id: 'orderPeriod', title: 'orderPeriod'},
    {id: 'orderSubPeriod', title: 'orderSubPeriod'},
    {id: 'distributionLoc', title: 'distributionLoc'},
    {id: 'orderStatus', title: 'orderStatus'},
    {id: 'payStatus', title: 'payStatus'},
    {id: 'customerId', title: 'customerId'},
    {id: 'custType', title: 'custType'},
    {id: 'orderSubTotal', title: 'orderSubTotal'},
    {id: 'orderTax', title: 'orderTax'},
    {id: 'orderDeposit', title: 'orderDeposit'},
    {id: 'orderDelivery', title: 'orderDelivery'},
    {id: 'orderDiscount', title: 'orderDiscount'},
    {id: 'orderTotal', title: 'orderTotal'},
    {id: 'orderCredits', title: 'orderCredits'},
    {id: 'orderPayments', title: 'orderPayments'},
    {id: 'orderBalance', title: 'orderBalance'},
    {id: 'orderSnapTotal', title: 'orderSnapTotal'},
    {id: 'orderSnapCashTotal', title: 'orderSnapCashTotal'},
    {id: 'orderDubTotal', title: 'orderDubTotal'},
    {id: 'orderPaymentsCredits', title: 'orderPaymentsCredits'},
    {id: 'balance', title: 'balance'},
    {id: 'preferredPayType', title: 'preferredPayType'},

    {id: 'iProductId', title: 'productId'},
    {id: 'iPrice', title: 'price'},
    {id: 'iQty', title: 'qty'},
    {id: 'iCost', title: 'cost'},
    {id: 'iStaxRate', title: 'stateTaxRate'},
    {id: 'iUnit', title: 'productUnitId'},
    {id: 'iFarm', title: 'producerId'},

    {id: 'iUnitCost', title: 'unitCost'},
    {id: 'iUnitWeight', title: 'unitWeight'},
    {id: 'iUnitPrice', title: 'unitPrice'},
    {id: 'extPrice', title: 'extPrice'},
    {id: 'fpType', title: 'pricingMethod'},
    {id: 'iSNAP', title: 'iSNAP'},
    {id: 'iDUB', title: 'iDUB'},
    {id: 'iSNAPCash', title: 'iSNAPCash'},
  ]
  const createCsvStringifier = require('csv-writer').createObjectCsvStringifier;
  let csvStringifier = createCsvStringifier({header: csvHeaders});
  if(!argv.continue) writableStream.write(csvStringifier.getHeaderString())

  let orderJSONResponse;
  let orderId = argv.start_at - 1
  let orderPeriods = {}
  let orderSubPeriods = {}
  let orderDistributionLocs = {}

  let lastOrderPeriod;
  let retry = false
  let pauseCounter = 0
  let orderCounter = 0
  let orderDate
  let orderJSON
  let pageLocator
  page.on('response', async (response) => {
    if(!response.url().match(/grow\/api\/Order/i) &&
       !response.url().match(/grow\/api\/CartOrder/i)
      ) return;
    logger.debug(`  << ${response.status()} ${response.url()}`)
    orderJSONResponse = response
  })

  while(true) {
    if(argv.num_orders && orderCounter > argv.num_orders){
      logger.info(`stopping after ${argv.num_orders} orders retrieved`)
      break
    }
    orderId++
    if(pauseCounter > pauseCounterLimit){
      logger.debug(`pausing for ${longDelay/1000} seconds`)
      await new Promise(r => setTimeout(r, longDelay));
      pauseCounter = 0
      csvStringifier = createCsvStringifier({header: csvHeaders});
    }

  await page.goto(ORDERS_URL)
  await page.waitForSelector('table.sticky-table-header', {state: 'visible'})

  await page.click('#periodId')
  await page.click("text='All Periods'")
  await page.click("text='Search Orders'")

  let orderIds = await page.$$('#content table.sticky-table-header tr td:nth-child(2)')
  for (let i = 0; i < orderIds.length; i++) {
    let orderId = (await orderIds[i].innerText()).trim()
    if(orderId === '') continue
    let pagePromise = browser.waitForEvent('page');
    console.log(`scrap id: ${orderId}`)
    await orderIds[i].click()
    let newPage = await pagePromise;
    await newPage.waitForLoadState();
    newPage.close()
  }

    await page.goto(ORDERS_URL + orderId);

    try {
      await page.on('domcontentloaded', data => {});
      await page.waitForSelector('table.sticky-table-header', {state: 'visible', timeout: 1 * 1000})
    } catch (e) {
      if(await page.isVisible("text='No order items.'")){
        //no items; skipping
        logger.debug(`order id: ${orderId} had no items in cart`)
        logger.debug('       - skipping')
        continue
      }
      logger.info(`order id: ${orderId} failed to load`)
      if(await page.isVisible('#message.uk-form-danger')){
        logger.info('       - skipping')
      }else if(!retry){
        await page.screenshot({ path: `output/order_${orderId}.png` });
        logger.error('       - pausing and then retrying')
        await new Promise(r => setTimeout(r, longDelay));
        orderId--
        retry = true
      }else{
        await page.screenshot({ path: `output/order_${orderId}.png` });
        logger.error('       - FAILED ')
      }
      continue
    }
    retry = false
    pauseCounter++

    orderDate = await page.locator('input[name="orderDate"]').nth(0).inputValue()

    if(_.isEmpty(orderPeriods)){
      pageLocator = page.locator('#oPeriodId:first-of-type > option').nth(0)
      await pageLocator.waitFor({state: 'attached'});
      for (const option of (await page.locator('#oPeriodId:first-of-type > option').all())) {
        orderPeriods[await option.getAttribute('value')] = await option.innerText()
      }
      let orderPeriodIds = _.keys(orderPeriods)
      lastOrderPeriod = parseInt(orderPeriodIds[orderPeriodIds.length - 2])
    }

    pageLocator = page.locator('#oPickupDayId:first-of-type > option').nth(0)
    await pageLocator.waitFor({state: 'attached'});
    for (const option of (await page.locator('#oPickupDayId:first-of-type > option').all())) {
      orderSubPeriods[await option.getAttribute('value')] = await option.innerText()
    }

    pageLocator = page.locator('#oLocId:first-of-type > option').nth(0)
    await pageLocator.waitFor({state: 'attached'});
    for (const option of (await page.locator('#oLocId:first-of-type > option').all())) {
      orderDistributionLocs[await option.getAttribute('value')] = await option.innerText()
    }

    orderJSON = await orderJSONResponse.json()
    if(orderJSON['oPeriodId'] == lastOrderPeriod) continue

    orderJSON['orderDate'] = orderDate
    orderJSON['orderPeriod'] = orderPeriods[orderJSON['oPeriodId']]
    orderJSON['distributionLoc'] = orderDistributionLocs[orderJSON['oLocId']]
    orderJSON['orderSubPeriod'] = orderSubPeriods[orderJSON['oPickupDayId']]
    writableStream.cork()
    let items = orderJSON.items ? orderJSON.items : orderJSON.cartItems
    for (const item of items) {
      orderJSON.iProductId = item.iProductId
      orderJSON.iPrice = item.iPrice
      orderJSON.iQty = item.iQty
      orderJSON.iCost = item.iCost
      orderJSON.iStaxRate = item.iStaxRate
      orderJSON.iUnit = item.iUnit
      orderJSON.iFarm = item.iFarm
      orderJSON.iUnitCost = item.iUnitCost
      orderJSON.iUnitWeight = item.iUnitWeight
      orderJSON.iUnitPrice = item.iUnitPrice
      orderJSON.extPrice = item.extPrice
      orderJSON.fpType = item.fpType
      orderJSON.iSNAP = item.iSNAP
      orderJSON.iDUB = item.iDUB
      orderJSON.iSNAPCash = item.iSNAPCash
      writableStream.write(csvStringifier.stringifyRecords([orderJSON]))
    }
    writableStream.uncork()
    logger.info(`order id: ${orderId} success`)
    orderCounter++
  }
  writableStream.end()
}

const retrieveProductAvailabilityData = async (page) => {
  // let productAvailabilityData = {}

  const createCsvWriter = require('csv-writer').createObjectCsvWriter;
  const csvWriter = createCsvWriter({
    path: 'product_availability.csv',
    header: [
      {id: 'period', title: 'period'},
      {id: 'category', title: 'category'},
      {id: 'subcategory', title: 'subcategory'},
      {id: 'prName', title: 'productName'},
      {id: 'productId', title: 'productId'},
      {id: 'producer', title: 'producer'},
      {id: 'producerGuid', title: 'producerId'},
      {id: 'fpType', title: 'pricingMethod'},
      {id: 'fpBaseUnit', title: 'baseUnit'},
      // {id: 'fpId', title: 'fpId'},
      // {id: 'hiId', title: 'hiId'},
      {id: 'puId', title: 'productUnitId'},
      {id: 'puMultiplier', title: 'unitMultiplier'},
      {id: 'listedBaseUnit', title: 'listedBaseUnit'},
      {id: 'prUnitAvail', title: 'prUnitAvail'},
      {id: 'qtyRemaining', title: 'qtyRemaining'},
      {id: 'prUnit', title: 'productUnit'},
      {id: 'prQty', title: 'qty'},
      {id: 'prAvail', title: 'available'},
      {id: 'prSold', title: 'sold'},
      {id: 'puWeight', title: 'weight'},
      {id: 'prPrice', title: 'price'},
    ]
  });

  await page.goto(PRODUCT_AVAILABILITY_URL);
  await page.waitForSelector('#availability-table', {state: 'visible'})

  // let orderIds = await page.locator('#content table.sticky-table-header tr td:nth-child(2)').allInnerTexts()
  // _.remove(orderIds, el => el === '')
  page.on('response', async (response) => {
    if(!response.url().match(/grow\/api\/AdminAvailability/i)) return;
    logger.debug('  <<', response.status(), response.url())

    let productDataJSON = await response.json();
    let periodDate = productDataJSON['items'][0]['period'].trim();
    //productId: across producers...
    let prevProductAType = productDataJSON['items'][0];
    let trimmedItems = _.filter(productDataJSON['items'], function(currObj) {
      if(currObj.producer.match(/on vacation/i)) return false;
      if(currObj.prName.match(/FMNP/i)) return false;
      if(SKIP_CATEGORIES.includes(currObj.category)) return false;
      if(currObj.puHide) return false;
      if(currObj.prQty === 0 && currObj.prAvail === 0) return false;
      // //NOTE: sort order matters; right now the sort order is the base unit
      if(collapseARecords && currObj.fpType === 'A' && prevProductAType && prevProductAType.fpId === currObj.fpId) return false

      // data cleanup
      if(currObj.prAvail < 0){
        if(currObj.prQty < currObj.prSold) currObj.prQty = currObj.prSold
        currObj.prAvail = 0;
      }
      prevProductAType = currObj
      return true
    });
    await csvWriter.writeRecords(trimmedItems)
  })

  for (let i = 2; i < allPeriods.length; i++) {
    let periodDate = await allPeriods[i].textContent();
    logger.info('period: ', periodDate)
    let periodId   = await allPeriods[i].getAttribute('value')
    try {
      await page.selectOption('select#periodId', periodId);
      await page.waitForSelector('#availability-table tbody', {state: 'visible'})
      await new Promise(r => setTimeout(r, fetchDelay));
    } catch (e) {
      if (e instanceof playwright.errors.TimeoutError) {
        logger.error("RETRY for ", periodDate)
        // retry once!
        await page.selectOption('select#periodId', periodId);
        await page.waitForSelector('#availability-table tbody', {state: 'visible', timeout: 10*1000})
      } else {
        throw e;  // re-throw the error unchanged
      }
    }
  }
}



