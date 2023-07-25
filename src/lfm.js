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

// FIXME: figure out taxable state
//                             https://sanjuanislandsfoodhub.lfmadmin.com/grow/api/ProductTable/?category=-1&page=1&showNoImg=false&searchString=soap
// prNtax: "N/A"

// https://sanjuanislandsfoodhub.lfmadmin.com/grow/api/Product/?category=undefined&prodId=3190

// prTaxable

// https://sanjuanislandsfoodhub.lfmadmin.com/grow/api/AdminAvailability/?periodId=170&subperiodIds=-1%2C1%2C2&producerId=ccfe9934-8ec7-44ad-a667-e3e6486a933b&regionId=&listId=&sortBy=category&categoryId=&subcategoryId=&priceLevelId=&exportCSVFile=false&showProducerPriceInExport=false&showHiddenUnitsInExport=false&showQtySoldInExport=false&showHiddenPriceLevels=true&showFeatured=false&showInventory=false&showFixedPriceProductsOnly=false&showOnSaleProductsOnly=false&showHiddenProductsOnly=false&showSnapProductsOnly=false&showDoubleUpProductsOnly=false&showSoldOutOnly=false&showManagedInventory=false

const LFM_CUSTOMER_ID = 1728

// anything more leads to diminishing returns, esp. on the server
const LFM_CONCURRENT_CALL_LIMIT = 3

class LFM {
  constructor (headful = false) {
    this._userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium'))
    this._headful = headful
  }

  async login () {
    this.browser = await chromium.launchPersistentContext(this._userDataDir, { headless: !this._headful, acceptDownloads: false })
    this.page = await this.browser.newPage()
    await this.page.goto(LOGIN_URL)
    await this.page.fill('input[name="Email"]', config.get('lfm_username'))
    await this.page.fill('input[name="Password"]', config.get('lfm_password'))
    await this.page.click('button[type="submit"]')
  }

  async close () {
    if (this.page) {
      this.page.close()
      this.browser.close()
      this.page = null
      this.browser = null
    }
  }

  // this returns an array of products:
  //  - only include those products listed as available at the wholesale window
  //  -
  async getAvailProducts (ignore_closed_period) {
    await this.page.goto(PRODUCTS_AVAIL_URL)
    // select ONLY wholesale products for now
    await this.page.waitForSelector('#subperiodIds', { state: 'visible' })
    await this.page.locator('select#subperiodIds').click()
    await this.page.waitForSelector('ul#subperiodIds #anchor_subperiodIds', { state: 'visible' })
    await this.page.locator('ul#subperiodIds #anchor_subperiodIds li:nth-child(2)').click()
    // show wholesale pricing
    await this.page.selectOption('select#priceLevelId', { label: 'Wholesale' })

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

    // do NOT show hidden prices
    // await this.page.locator(`.admin-availability-button-group button.plain-dropdown-button:visible`).click()
    await this.page.locator(`.admin-availability-button-group button.plain-dropdown-button:visible:near(:text("Price Level Filters"))`).click()
    await this.page.locator('label:has-text("Show Hidden Price Levels"):visible').click()

    // Wait for the specific XHR request to set productRequest
    // this looks janky but is more robust than using page.waitForRequest,
    // as there is a chance we may miss it
    while (!productRequest) {
      await delay(10)
    }
    const prodResponse = await (await productRequest.response()).json()
    const requestParams = this._urlParams(productRequest.url())
    if(!ignore_closed_period){
      if (!await this._isPeriodOpen(requestParams.periodId, requestParams.subperiodIds)) {
        logger.verbose('period is now closed to ordering')
        return []
      }else{
        logger.debug("period is open!")
      }
    }

    if (prodResponse.readOnly) {
      logger.error('period is no longer open!')
      return []
    }
    const rawProducts = prodResponse.items
    const products    = this._cleanupProducts(rawProducts)
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
      // this can also be because the item is a B1, which only allows a qty of 1 to be listed
      const delta = qty - prevQty
      if (delta > 0) {
        return await this._addNewItemToOrder(productUnitId, delta)
      } else {
        for (let i = delta; i < 0; i++) {
          await this._modifyExistingItemOnOrder(productUnitId, 0, 1)
        }
        return
      }
    //   logger.error('previous qty was not found... investigate; meanwhile, not modifying')
    //   return false
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
      // waiting on the page.on('request') loop
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

  async _isPeriodOpen (periodId, subPeriodId) {
    //NOTE: perhaps hit https://sanjuanislandsfoodhub.localfoodmarketplace.com/Products and
    // scan for 'Get ready to shop'?  ugh
    const periodData = await this.page.evaluate(async (url) => {
      const fetchResponse = await fetch(url)
      return await fetchResponse.json()
    }, `https://sanjuanislandsfoodhub.lfmadmin.com/grow/api/SetupPeriodEdit/${periodId}`)

    const subPeriodData = periodData.subperiods.find(sub => sub.psDayId === parseInt(subPeriodId))
    const today = new Date()
    const startDate = new Date(`${subPeriodData.firstOrderDay} ${subPeriodData.firstOrderTime}`)
    const endDate = new Date(`${subPeriodData.orderCutoffDay} ${subPeriodData.orderCutoffTime}`)
    logger.debug(`_isPeriodOpen: id: ${periodId}, subId: ${subPeriodId} - ${startDate.toISOString()} <-> ${endDate.toISOString()} --- ${today.toISOString()} -- ${today >= startDate && today <= endDate}`)
    return (today >= startDate && today <= endDate)
  }

  _urlParams (url) {
    const urlParams = url.split('?')[1]
    const params = _.fromPairs(
      _.map(urlParams.split('&'), (param) => param.split('='))
    )
    return params
  }

  _cleanupProducts (rawProducts) {
    _.remove(rawProducts, (item) => {
      //NOTE: not sure what this line item does or why it is here
      // return (item.prAvail === 0 && item.prUnitAvail === -1) ||
      return item.puHide === true || // || item.listed === false
      // remove items which have no items listed but are still active
      item.prQty === 0 && item.prAvail === 0 && item.prSold === 0 ||
      item.producer.match(/ON VACATION/i) !== null
    })

    // modifyPricing
    _.each(rawProducts, (item) => {
      item.prPrice = parseFloat(item.prPrice)
      item.customerPrice = parseFloat(item.customerPrice)
      if (variableSet(item.puWeight)) {
        item.customerPricePerLbs = item.customerPrice
        item.puWeight       = parseFloat(item.puWeight)
        item.customerPrice *= item.puWeight
        item.customerPrice  = _.round(item.customerPrice, 2);
      }else{
        item.puWeight            = undefined
        item.customerPricePerLbs = undefined
      }
    })
    const desiredKeys = ['category', 'subcategory', 'prName', 'producer', 'prUnit', 'prAvail', 'prPrice', 'customerPrice', 'customerPricePerLbs', 'puWeight', 'productId', 'puId', 'fpId']
    let products = rawProducts.map(obj => _.pick(obj, desiredKeys))
    products = _.map(products, obj => {
      return _.mapValues(obj, value => (typeof value === 'string' ? value.trim() : value));
    });
    return products
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
      //if the img isn't set, fpImage returns an invlaid url that is, oddly, blob:https://app.localfoodconnect.com/fc51338e-ca0f-40c9-969b-bf27b19f8b5c
      const productImg = variableSet(data.fpImage) && data.fpImage.match(/^http/i) ? data.fpImage : data.fpDefaultImage
      return {
        productImgUrl: productImg,
        productTagline: data.fpTag.trim(),
        productDesc: data.fpDesc.trim(),
        productFrozen: data.prFrozen,
        productCold: data.prCold,
        units: _.keyBy(data.units, 'puId'),
        fpId
      }
    }

    const uniqueFpIDs = _.uniqBy(products, obj => obj.fpId).map(obj => obj.fpId)
    const promises = uniqueFpIDs.map(fpId => limiter(() => enrichItem(fpId)))
    // try {
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
    // } catch (error) {
    //   console.error('Error:', error)
    // }
    return products
  }

  async _addNewItemToOrder (productUnitId, qty) {
    logger.verbose(`adding new item to LFM order.  ProdUnitID: ${productUnitId}; qty: ${qty}`)
    await this.page.locator('.uk-container .uk-grid a span[title="Add products to this order."]').locator('visible=true').click()
    const checkboxSelector = 'input[type="checkbox"][name="searchHidden"]'
    const isChecked = await this.page.isChecked(checkboxSelector)
    if (isChecked) {
      await this.page.click(checkboxSelector) // Toggle the checkbox to uncheck it
    }

    const productRequestPromise = this.page.waitForRequest(request => {
      return request.resourceType() === 'xhr' &&
             request.url().includes('/grow/api/OrderProductSearch') &&
             request.url().includes(`productSearchString=${productUnitId}`)
    })
    logger.debug(`searching for product unit #${productUnitId}`)
    const searchField = await this.page.locator('#productSearchString')
    await searchField.fill(_.toString(productUnitId))
    await searchField.press('Tab')
    // NOTE: this is a hack, BUT sometimes LFM fires off a bunch of requests and
    await this.page.waitForLoadState('networkidle')
    // await delay(200)
    const productRequest = await productRequestPromise
    const prodResponse = await productRequest.response()
    const foundProducts = (await prodResponse.json()).items
    if (foundProducts.length === 0) {
      logger.error('FIXME: no product found')
      // FIXME:
    } else if (foundProducts.length > 1) {
      logger.error('FIXME: too many products found')
      // FIXME:
    } else if (foundProducts[0].qtyAvail < 1) {
      logger.error('FIXME: product no longer available')
      // FIXME
    } else {
      // NOTE: the response may have come in, but the page may not have finished refreshing...
      // so added an additional wait and tighter selectors
      await this.page.locator(`.uk-modal-dialog-large .sticky-table-header td:has-text("${foundProducts[0].prName}")`).locator('visible=true').waitFor()
      await this.page.locator('.uk-modal-dialog-large .sticky-table-header td input[type="text"]#qty').locator('visible=true').focus()
      await this.page.keyboard.type(_.toString(qty))
      await this.page.click('.uk-modal-dialog-large button:visible:has-text("Done")')
    }
    logger.verbose('ADDED')
  }

  async _modifyExistingItemOnOrder (productUnitId, qty, prevQty) {
    if (!prevQty) return false
    logger.verbose(`modifying exiting item on LFM order.  ProdUnitId: ${productUnitId}; qty: ${qty}; prev qty: ${prevQty}`)

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
    const headers = await (await this.page.locator('table.sticky-table-header thead tr th').locator('visible=true')).allInnerTexts()
    const qtyLoc = headers.findIndex(h => h.match(/qty/i))
    const rows = await (await this.page.locator('table.sticky-table-header tbody tr').locator('visible=true')).all()
    for (const r of rows) {
      const vals = (await r.innerText()).split('\t')
      if (_.isEqual(foundProduct.prName, vals[0]) &&
         _.isEqual(foundProduct.producerName, vals[1]) &&
         _.isEqual(foundProduct.puDesc, vals[2])) {
        const qtys = await r.locator('td').nth(qtyLoc).textContent()
        const currQty = parseInt(qtys[0])
        if (currQty === prevQty) {
          if (qty > 0) {
            const inputField = await r.locator('td').nth(qtyLoc).locator('input')
            if ((await inputField.count()) > 0) {
              logger.debug('modifying input')
              await inputField.fill(_.toString(qty))
              await inputField.press('Tab')
            } else {
              logger.debug('not modifiable')
              // can't modify; must add
              return false
            }
          } else {
            logger.debug('deleting')
            const reloadAfterDeletePromise = this.page.waitForRequest(request => request.url().includes('/grow/api/Order/'))
            await r.locator('td a span[title="Delete order item"]').click()
            await this.page.click('.uk-modal-dialog button.js-modal-confirm:visible:has-text("Ok")')
            await reloadAfterDeletePromise
          }
          matchFound = true
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
