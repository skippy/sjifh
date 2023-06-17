const logger = require('./modules/logger.js')
const config = require('./config.js')
const fetch = require('node-fetch')
const limitPromise = import('p-limit')

const ShopifyApi = require('shopify-api-node')
const _ = require('lodash')
const hostname = `${config.get('shopify_shop_origin')}.myshopify.com`

class Shopify {
  // this is a bit redundant with the ShopifyAPI autoLimit
  // however, autoLimit doesn't always work as well as expected
  // so leaving this older approach in
  static CONCURRENT_API_LIMIT = 5

  constructor () {
    this.client = new ShopifyApi({
      accessToken: config.get('shopify_access_token'),
      isCustomStoreApp: true,
      isEmbeddedApp: false,
      autoLimit: { calls: 2, interval: 1100, bucketSize: 30 },
      shopName: hostname
    })
    this._locationPromise = this.client.location.list()
  }

  async getAllProducts (block) {
    let options = {
      limit: 200, // Maximum number of products per page (maximum is 250)
      vendor: config.get('shopify_vendor_name')
    }
    const allProducts = []
    let counter = 0
    do {
      const products = await this.client.product.list(options)
      counter += products.length
      if (typeof block === 'function') {
        for (const prod of products) {
          await block(prod)
        }
      } else {
        allProducts.push(...products)
      }
      options = products.nextPageParameters
    } while (options !== undefined)
    logger.verbose(`retrieved Shopify products: ${counter}`)

    return (typeof block === 'function') ? null : allProducts
  }

  async deleteAllProducts () {
    const { default: limit } = await limitPromise
    const limiter = limit(Shopify.CONCURRENT_API_LIMIT)
    const promises = []
    await this.getAllProducts((product) => {
      const promise = limiter(() => {
        logger.debug(`deleting shopify product id ${product.id}`)
        return this.client.product.delete(product.id)
      })
      promises.push(promise)
      // await this.client.product.delete(product.id)
    })
    await Promise.all(promises)
  }

  async archiveAllProducts () {
    const { default: limit } = await limitPromise
    const limiter = limit(Shopify.CONCURRENT_API_LIMIT)
    const promises = []
    await this.getAllProducts((product) => {
      if (product.status === 'archived') return
      const promise = limiter(() => {
        logger.debug(`archiving shopify product id ${product.id}`)
        return this.client.product.update(product.id, { status: 'archived' })
      })
      promises.push(promise)
    })
    await Promise.all(promises)
  }

  async archiveProduct (prodId) {
    return await this.client.product.update(prodId, { status: 'archived' })
  }

  async updateProduct (prod) {
    // Shopify deprecated setting qty direclty
    // if we do... weird stuff happens and the store will show
    // the right qty BUT you can't buy it
    // (once added to the cart, it removes itself in a few minutes)
    return (async () => {
      const qty = prod.variants[0].inventory_quantity
      delete prod.variants[0].inventory_quantity
      const updated = await this.client.product.update(prod.id, prod)
      //       if(updated.variants[0].requires_shipping){
      // console.log('ok---?')
      //         await this.client.inventoryItem.update(updated.variants[0].inventory_item_id, {requires_shipping: false})
      //       }
      // console.log(updated)
      const locations = await this._getLocations()
      for (const loc of locations) {
        await this.client.inventoryLevel.set({ location_id: loc.id, inventory_item_id: updated.variants[0].inventory_item_id, available: qty })
      }
    })()
  }

  async createProduct (prod) {
    return (async () => {
      const qty = prod.variants[0].inventory_quantity
      delete prod.variants[0].inventory_quantity
      const product = await this.client.product.create(prod)
      await this.client.inventoryItem.update(product.variants[0].inventory_item_id, { requires_shipping: false })
      const locations = await this._getLocations()
      for (const loc of locations) {
        await this.client.inventoryLevel.set({ location_id: loc.id, inventory_item_id: product.variants[0].inventory_item_id, available: qty })
      }
    })()
  }

  productIsArchived (prod) {
    return prod.status === 'archived'
  }

  async _getLocations () {
    return await this._locationPromise
  }
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = Shopify
