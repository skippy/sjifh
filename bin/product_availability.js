#!/usr/bin/env node
'use strict';

const fs     = require('fs');
const yargs  = require('yargs');
const logger = require(`${process.mainModule.path}/../src/modules/logger`);
const _      = require('lodash');
const { hideBin } = require('yargs/helpers');
const stayAwake = require('stay-awake');

stayAwake.prevent(function() {});
require("dotenv").config();

process.env.TZ = 'UTC';

const LOGIN_URL            = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Account/Login';
const PRODUCT_AVAILABILITY_URL = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Home/AdminAvailability';
const ORDERS_ID_START          = 10003
const ORDERS_URL               = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Order/Detail/'

const LFM_USERNAME = process.env.LFM_USERNAME;
const LFM_PASSWORD = process.env.LFM_PASSWORD;

const SKIP_CATEGORIES = ['Other Goods', 'Community Support', 'Prepared Foods']

const collapseARecords = true

const outputFile = 'all_data'
const fetchDelay = 0.5 * 1000

const os   = require('os');
const path = require('path');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium'));
const playwright = require('playwright');
(async () => {
  const browser = await playwright.chromium.launchPersistentContext(userDataDir, { headless: false, acceptDownloads: true });
  const page    = await browser.newPage();

  await loginLFM(page)

  await retrieveOrderData(page)
  // await retrieveProductAvailabilityData(page)


  // let stringData = JSON.stringify(productAvailabilityData, null, 2);
  // fs.writeFileSync(`${outputFile}.json`, stringData);

  // var items = _.flatten(_.values(productAvailabilityData));

  // const replacer = (key, value) => value === null ? '' : value // specify how you want to handle null values here
  // const header = Object.keys(items[0])
  // const csv = [
  //   header.join(','), // header row first
  //   ...items.map(row => header.map(fieldName => JSON.stringify(row[fieldName], replacer)).join(','))
  // ].join('\r\n')

  // fs.writeFileSync(`${outputFile}.csv`, csv);

  // console.log(csv)


  browser.close();
})();


const loginLFM = async (page) => {
  await page.goto(LOGIN_URL);

  await page.fill('input[name="Email"]', LFM_USERNAME);
  await page.fill('input[name="Password"]', LFM_PASSWORD);
  await page.click('button[type="submit"]');
}


const retrieveOrderData = async (page) => {
  const createCsvWriter = require('csv-writer').createObjectCsvWriter;
  const csvWriter = createCsvWriter({
    path: 'orders.csv',
    header: [
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
  });
  let orderJSONResponse;
  page.on('response', async (response) => {
    if(!response.url().match(/grow\/api\/Order/i)) return;
    console.log('<<', response.status(), response.url())
    orderJSONResponse = response
  })
  let orderId = ORDERS_ID_START - 1
  let orderPeriods = {}
  let lastOrderPeriod;
  while(true) {
    orderId++
    await page.goto(ORDERS_URL + orderId);
// console.log(await page.locator('#message.uk-form-danger').isVisible())
//     if(await page.locator('#message.uk-form-danger').isVisible()) continue;

    try {
      await page.on('domcontentloaded', data => {});
//       let errPage = page.locator('#message.uk-form-danger')
//       let validPage = page.locator('table.sticky-table-header')
//       for (let i = 0; i < 10; i++){
// console.log('-----------')
// console.log(errPage.isVisible())
// console.log(validPage.isVisible())
// await new Promise(r => setTimeout(r, fetchDelay));
//       }
      await page.waitForSelector('table.sticky-table-header', {state: 'visible', timeout: 2 * 1000})
    } catch (e) {
      console.log(`order id: ${orderId} failed to load; skipping`)
      continue
    }

    await page.waitForSelector('table.sticky-table-header', {state: 'visible'})
    let orderDate = await page.locator('input[name="orderDate"]').nth(0).inputValue()

    if(_.isEmpty(orderPeriods)){
      let pageLocator = page.locator('#oPeriodId:first-of-type > option').nth(0)
      await pageLocator.waitFor({state: 'attached'});
      for (const option of (await page.locator('#oPeriodId:first-of-type > option').all())) {
        orderPeriods[await option.getAttribute('value')] = await option.innerText()
      }
      let orderPeriodIds = _.keys(orderPeriods)
      lastOrderPeriod = parseInt(orderPeriodIds[orderPeriodIds.length - 2])
    }
    let orderSubPeriods = {}
    let pageLocator = page.locator('#oPickupDayId:first-of-type > option').nth(0)
    await pageLocator.waitFor({state: 'attached'});
    for (const option of (await page.locator('#oPickupDayId:first-of-type > option').all())) {
      orderSubPeriods[await option.getAttribute('value')] = await option.innerText()
    }

    let orderDistributionLocs = {}
    pageLocator = page.locator('#oLocId:first-of-type > option').nth(0)
    await pageLocator.waitFor({state: 'attached'});
    for (const option of (await page.locator('#oLocId:first-of-type > option').all())) {
      orderDistributionLocs[await option.getAttribute('value')] = await option.innerText()
    }

    let orderJSON = await orderJSONResponse.json()
    if(orderJSON['oPeriodId'] == lastOrderPeriod) continue

    orderJSON['orderDate'] = orderDate
    orderJSON['orderPeriod'] = orderPeriods[orderJSON['oPeriodId']]
    orderJSON['distributionLoc'] = orderDistributionLocs[orderJSON['oLocId']]
    orderJSON['orderSubPeriod'] = orderSubPeriods[orderJSON['oPickupDayId']]
    for (const item of orderJSON.items) {
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
      await csvWriter.writeRecords([orderJSON])
    }
  }
  // await new Promise(r => setTimeout(r, fetchDelay));
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

  const allPeriods = await page.$$('#periodId option');


  page.on('response', async (response) => {
    if(!response.url().match(/grow\/api\/AdminAvailability/i)) return;
    console.log('<<', response.status(), response.url())

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
    console.log('period: ', periodDate)
    let periodId   = await allPeriods[i].getAttribute('value')
    try {
      await page.selectOption('select#periodId', periodId);
      await page.waitForSelector('#availability-table tbody', {state: 'visible'})
      await new Promise(r => setTimeout(r, fetchDelay));
    } catch (e) {
      if (e instanceof playwright.errors.TimeoutError) {
        console.log("RETRY for ", periodDate)
        // retry once!
        await page.selectOption('select#periodId', periodId);
        await page.waitForSelector('#availability-table tbody', {state: 'visible', timeout: 10*1000})
      } else {
        throw e;  // re-throw the error unchanged
      }
    }
  }
}

