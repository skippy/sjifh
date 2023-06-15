const config = require('./config.js')
const logger = require('./modules/logger.js')
const { chromium } = require('playwright')
const os = require('os')
const path = require('path')
const _ = require('lodash')
const fs = require('fs')
// FIXME: a standard 'require' doesn't work; need to use async import
// const limit = require('p-limit');
const limitPromise = import('p-limit')

const LOGIN_URL = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Account/Login'
const PRODUCTS_AVAIL_URL = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/Home/AdminAvailability'
const PRODUCT_PRICING_URL = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/api/UnitPrice/'

const LFM_CUSTOMER_ID = 1728

// anything more leads to diminishing returns, esp. on the server
const LFM_CONCURRENT_CALL_LIMIT = 3

class LFM {
  constructor (headful = false) {
    this._userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium'))
    this._headful = headful
  }

  async login () {
    const browser = await chromium.launchPersistentContext(this._userDataDir, { headless: !this._headful, acceptDownloads: false })
    this.page = await browser.newPage()
    await this.page.goto(LOGIN_URL)
    await this.page.fill('input[name="Email"]', config.get('lfm_username'))
    await this.page.fill('input[name="Password"]', config.get('lfm_password'))
    await this.page.click('button[type="submit"]')
  }

  // this returns an array of products:
  //  - only include those products listed as available at the wholesale window
  //  -
  async getAvailProducts (block) {
    await this.page.goto(PRODUCTS_AVAIL_URL)
    await this.page.waitForSelector('#subperiodIds', { state: 'visible' })
    await this.page.locator('select#subperiodIds').click()
    await this.page.waitForSelector('ul#subperiodIds #anchor_subperiodIds', { state: 'visible' })
    // select ONLY wholesale products for now
    await this.page.locator('ul#subperiodIds #anchor_subperiodIds li:nth-child(2)').click()

    let productRequest
    this.page.on('request', (request) => {
      // make sure we snag the right request, specifically one that does not
      // have all sub-periods selected
      if (request.resourceType() === 'xhr' &&
          request.url().includes('/grow/api/AdminAvailability') &&
          !request.url().includes('subperiodIds=-1')) {
        productRequest = request
      }
    })

    // select ONLY wholesale products for now
    await this.page.selectOption('select#priceLevelId', { label: 'Wholesale' })

    // Wait for the specific XHR request to set productRequest
    // this looks janky but is more robust than using page.waitForRequest,
    // as there is a chance we may miss it
    while (!productRequest) {
      await delay(10)
    }
    const prodResponse = await (await productRequest.response()).json()
    if (prodResponse.readOnly) {
      logger.error('period is no longer open!')
      return []
    }
    const rawProducts = prodResponse.items
    // console.log(rawProducts[0])
    // console.log(rawProducts[rawProducts.length - 1])
    // console.log(`==== ${rawProducts.length}`)
    _.remove(rawProducts, (item) => {
      // console.log(`here: ${(item.prAvail === 0 && item.prUnitAvail === -1)} || ${item.puHide === true}`);
      return (item.prAvail === 0 && item.prUnitAvail === -1) ||
      item.puHide === true // || item.listed === false
    })
    // console.log(rawProducts[0])
    // console.log(rawProducts[rawProducts.length - 1])
    // console.log(`==== ${rawProducts.length}`)
    // console.log(rawProducts[0].listed)
    // console.log(!rawProducts[0].listed)
    const desiredKeys = ['category', 'subcategory', 'prName', 'producer', 'prUnit', 'prAvail', 'prPrice', 'customerPrice', 'puWeight', 'productId', 'puId', 'fpId']
    const products = rawProducts.map(obj => _.pick(obj, desiredKeys))
    logger.verbose(`retrieved LFM products: ${products.length}`)

    // if(!enrich) return products

    // now we enrich each product with pricing information
    return await this._enrichProducts(products)
  }

  async modifyOrder (productUnitId, qty, prevQty) {
    await this.getOrder()
    const addItemToOrderSelector = '.uk-container .uk-grid a span[title="Add products to this order."]'
    await this.page.waitForSelector(addItemToOrderSelector, { state: 'visible' })

    // first see if this item already exists:
    const unitAlreadyModified = await this._modifyExistingItemOnOrder(productUnitId, qty, prevQty)
    if (unitAlreadyModified) return true
    if (prevQty) {
      logger.error('previous qty was not found... investigate; meanwhile, not modifying')
      return false
    }
    await this._addNewItemToOrder(productUnitId, qty)
  }

  async getOrder () {
    let orderRequest, periodRequest
    this.page.on('request', (request) => {
      if (request.resourceType() === 'xhr' &&
          request.url().includes('/grow/api/Utility/GetCustomerOrders')) {
        orderRequest = request
      }
      if (request.resourceType() === 'xhr' &&
          request.url().includes('/grow/api/Utility/GetPeriods')) {
        periodRequest = request
      }
    })

    await this.page.goto(`https://sanjuanislandsfoodhub.lfmadmin.com/grow/Customer/Detail/${LFM_CUSTOMER_ID}/?view=transactions`)
    await this.page.waitForLoadState('domcontentloaded')
    while (!orderRequest && !periodRequest) {
      await delay(10)
    }
    const orders = await (await orderRequest.response()).json()
    const recentOrder = orders[0]
    const periods = await (await periodRequest.response()).json()
    const latestPeriod = periods[1].optionValue // periods[0] is a placeholder for a select dropdown menue
    let latestOrderIsCurrentPeriod = false
    if (recentOrder) {
      const currPeriodDate = new Date(latestPeriod)
      const latestOrderDate = new Date(recentOrder.pStarts)
      latestOrderIsCurrentPeriod = _.isEqualWith(currPeriodDate, latestOrderDate, _.isDate)
    }
    const orderPagePromise = this.page.context().waitForEvent('page', p => p.url().includes('/grow/Order/Detail'))

    if (latestOrderIsCurrentPeriod) {
      this.page.click(`table.sticky-table-header tr td:has-text("${orders[0].orderId}")`)
    } else {
      await this.page.waitForSelector('.uk-container .uk-grid .uk-hidden-small a[title="New Order"] span.uk-icon-large', { state: 'visible' })
      await this.page.click('.uk-container .uk-grid .uk-hidden-small a[title="New Order"] span.uk-icon-large', { position: { x: 20, y: 5 } })
      const options = await this.page.$$('#subperiodId option')
      await this.page.selectOption('#subperiodId', '2')
      await this.page.click('button:visible:has-text("Continue")')
    }
    this.page = await orderPagePromise
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.bringToFront()
    return this.page.url()
  }

  async _enrichProducts (products) {
    // now we enrich each product with pricing information
    const { default: limit } = await limitPromise

    const limiter = limit(LFM_CONCURRENT_CALL_LIMIT)
    const enrichItem = async (fpId) => {
      const productInfo = 'https://sanjuanislandsfoodhub.lfmadmin.com/grow/api/ProducerProduct/' + fpId
      const data = await this.page.evaluate(async (url) => {
        const fetchResponse = await fetch(url)
        return await fetchResponse.json()
      }, productInfo)
      const productImg = variableSet(data.fpImage) ? data.fpImage : data.fpDefaultImage
      return {
        productImgUrl: productImg,
        productTagline: data.fpTag,
        productDesc: data.fpDesc,
        productFrozen: data.prFrozen,
        productCold: data.prCold,
        units: _.keyBy(data.units, 'puId'),
        fpId
      }
    }

    const uniqueFpIDs = _.uniqBy(products, obj => obj.fpId).map(obj => obj.fpId)
    const promises = uniqueFpIDs.map(fpId => limiter(() => enrichItem(fpId)))
    try {
      const enrichedData = await Promise.all(promises)
      const enrichedHash = _.keyBy(enrichedData, 'fpId')
      for (const prod of products) {
        const enrichedProd = enrichedHash[prod.fpId]
        _.merge(prod, _.omit(enrichedProd, 'units'))
        // _.merge(prod, enrichedProd)
        const enrichedProdUnit = enrichedProd.units[prod.puId.toString()]
        // NOTE: sometimes the puWeight is not already on the product info, but
        // it is here from this subcall... so we just add it just in case
        if (!variableSet(prod.puWeight)) {
          prod.puWeight = enrichedProdUnit.puWeight
        }
      }
    } catch (error) {
      console.error('Error:', error)
    }
    return products
  }

  async _addNewItemToOrder (productUnitId, qty) {
    const addItemToOrderSelector = '.uk-container .uk-grid a span[title="Add products to this order."]'
    await this.page.click(addItemToOrderSelector)
    let productRequest
    const checkboxSelector = 'input[type="checkbox"][name="searchHidden"]'
    const isChecked = await this.page.isChecked(checkboxSelector)
    if (isChecked) {
      await this.page.click(checkboxSelector) // Toggle the checkbox to uncheck it
    }

    this.page.on('request', (request) => {
      // make sure we snag the right request, specifically one that does not
      // have all sub-periods selected
      if (request.resourceType() === 'xhr' &&
          request.url().includes('/grow/api/OrderProductSearch')) {
        productRequest = request
      }
    })
    await this.page.focus('#productSearchString') // Focus on the input field
    await this.page.keyboard.type(_.toString(productUnitId))

    while (!productRequest) {
      await delay(10)
    }
    const prodResponse = await productRequest.response()
    const foundProducts = (await prodResponse.json()).items
    if (foundProducts == 0) {
      logger.error('FIXME: no product found')
      // FIXME:
    } else if (foundProducts > 1) {
      logger.error('FIXME: too many products found')
      // FIXME:
    } else {
      await this.page.focus('.sticky-table-header td input[type="text"]#qty')
      await this.page.keyboard.type(_.toString(qty))
      await this.page.click('button:visible:has-text("Done")')
    }
  }

  async _modifyExistingItemOnOrder (productUnitId, qty, prevQty) {
    if (!prevQty) return false

    let matchFound = false
    // FIXME?  rather than doing a separate prod search, should we just use: getAvailProducts?
    const orderId = _.last(this.page.url().split('/'))
    const prodSearchUrl = `https://sanjuanislandsfoodhub.lfmadmin.com/grow/api/OrderProductSearch/${orderId}?producerGuid=-1&parentCatId=&subCatId=&productSearchString=&searchType=current_subperiod&searchHidden=false`
    const products = await this.page.evaluate(async (url) => {
      const fetchResponse = await fetch(url)
      return (await fetchResponse.json()).items
    }, prodSearchUrl)
    const foundProduct = products.find(prod => _.toString(prod.puId) === _.toString(productUnitId))
    if (!foundProduct) {
      logger.error('no product found?')
      // FIXME: throw exception?
      return false
    }
    // if not found in current order AND quantity is negative, nothing to do
    const rows = await this.page.$$('table.sticky-table-header tbody tr')
    for (const r of rows) {
      const vals = await r.$$eval('td', tds => tds.map(td => td.textContent))
      if (_.isEqual(foundProduct.prName, vals[0]) &&
         _.isEqual(foundProduct.producerName, vals[1]) &&
         _.isEqual(foundProduct.puDesc, vals[2]) &&
         _.isEqual(foundProduct.fpUnitCost, parseFloat(vals[4].replace('$', '')))) {
        const qtys = await r.$$eval('td input', tds => tds.map(td => td.value))
        const currQty = parseInt(qtys[0])
        if (currQty == prevQty) {
          matchFound = true
          if (qty > 0) {
            const inputField = await r.$('td input')
            await inputField.fill(_.toString(qty))
            await inputField.press('Tab')
          } else {
            const deleteField = await r.$('td a span[title="Delete order item"]')
            await deleteField.click()
            await this.page.click('.uk-modal-dialog button.js-modal-confirm:visible:has-text("Ok")')
          }
          break
        }
      }
    }
    if (matchFound) {
      logger.verbose('modified quantity; finished')
      return true
    }
    logger.error('did not find qty match... what do we do here?')
    // FIXME
    return false
  }
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function variableSet (value) {
  if (_.isNil(value)) {
    return false
    // console.log('Variable is not set.');
  } else if (_.isString(value) && _.trim(value).length === 0) {
    return false
    // console.log('Variable is set but contains only whitespace.');
  } else if (_.isString(value) && value.length === 0) {
    return false
    // console.log('Variable is set but empty.');
  } else if (_.isEmpty(value)) {
    return false
    // console.log('Variable is set but blank.');
  } else {
    return true
    // console.log('Variable is set and not empty or blank.');
  }
}
module.exports = LFM
