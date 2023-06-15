const logger = require('./modules/logger.js')
const config = require('./config.js')
const fetch = require('node-fetch')
const limitPromise = import('p-limit')

const ShopifyApi = require('shopify-api-node')
const _ = require('lodash')
const hostname = `${config.get('shopify_shop_origin')}.myshopify.com`

class Shopify {
  static CONCURRENT_API_LIMIT = 20

  constructor () {
    this.client = new ShopifyApi({
      accessToken: config.get('shopify_access_token'),
      isCustomStoreApp: true,
      isEmbeddedApp: false,
      autoLimit: true,
      shopName: hostname
    })
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
    return await this.client.product.update(prod.id, prod)
  }

  async createProduct (prod) {
    return await this.client.product.create(prod)
  }

  async productIsArchived(prod) {
    return prod.status === 'archived'
  }
}

module.exports = Shopify
