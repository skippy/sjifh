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
  static CONCURRENT_API_LIMIT = 4

  constructor () {
    this.client = new ShopifyApi({
      accessToken: config.get('shopify_access_token'),
      isCustomStoreApp: true,
      isEmbeddedApp: false,
      autoLimit: { calls: 2, interval: 1100, bucketSize: 30 },
      shopName: hostname
    })
  }

  async getAllProducts (block) {
console.log('   called')
    let options = {
      limit: 200, // Maximum number of products per page (maximum is 250)
      collection_id: config.get('shopify_collection_id')
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
console.log('within')
    await this.getAllProducts((product) => {
console.log(`here-1: ${product}`)
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


  async createProductStruct (title, productType, tagsArr, vendor, bodyHtml, sku, imgUrl, price, qty) {
    let base64Image
    if (imgUrl) {
      const fetchResponse = await fetch(imgUrl)
      const imgBbuffer = await fetchResponse.buffer()
      base64Image = Buffer.from(imgBbuffer).toString('base64')
    }

    _.forEach(tagsArr, (tag, index) => {
      tagsArr[index] =  tag.toUpperCase();
    });

    if (qty < 0) qty = 0

    const shopifyProduct = {
      title: title,
      status: 'active',
      product_type: productType,
      tags: tagsArr,
      vendor: vendor,
      bodyHtml,
      sku: sku,
      images: [
        {
          attachment: base64Image
        }
      ],
      variants: [
        {
          price: price,
          sku: sku,
          // what about taxable?
          taxable: false,
          inventory_quantity: qty,
          // requires_shipping: false,
          inventory_management: 'shopify'
          // what about weight unit?!
          // weight: _.isEmpty(lfmProd.puWeight) ? null : parseFloat(lfmProd.puWeight),
        }
      ]
    }
    if (!base64Image) {
      delete shopifyProduct.images
    }
    return shopifyProduct
  }


  async archiveProduct (prodId) {
    return await this.client.product.update(prodId, { status: 'archived' })
  }


  async updateProduct (prod) {
    // Shopify deprecated setting qty direclty
    // if we do... weird stuff happens and the store will show
    // the right qty BUT you can't buy it
    // (once added to the cart, it removes itself in a few minutes)
    // SO, delete qty but set the Inventory Level for the item
    return (async () => {
      // clone so we don't modify the prod object, which we may use elsewhere!
      const prodCopy = _.cloneDeep( prod )
      const qty = prodCopy.variants[0].inventory_quantity
      delete prodCopy.variants[0].inventory_quantity
      const updated = await this.client.product.update(prodCopy.id, prodCopy)
      await this._setInventoryLevel(updated.variants[0].inventory_item_id, qty)
    })()
  }

  //TODO:
  //  - can I put this around a transaction so multiple processes running at the same
  //    time don't create multiple products?
  async createProduct (prod) {
    // Shopify deprecated setting qty direclty
    // if we do... weird stuff happens and the store will show
    // the right qty BUT you can't buy it
    // (once added to the cart, it removes itself in a few minutes)
    // SO, delete qty but set the Inventory Level for the item
    //
    // ALSO, set the require shipping to false; no need to keep setting this at update time...
    return (async () => {
      // clone so we don't modify the prod object, which we may use elsewhere!
      const prodCopy = _.cloneDeep( prod )
      const qty = prodCopy.variants[0].inventory_quantity
      delete prodCopy.variants[0].inventory_quantity
      const product = await this.client.product.create(prodCopy)

      await this.client.inventoryItem.update(prodCopy.variants[0].inventory_item_id, { requires_shipping: false })

      await this._setInventoryLevel(prodCopy.variants[0].inventory_item_id, qty)
    })()
  }


  async _setInventoryLevel(inventoryItemId, qty) {
    const locations = await this.client.location.list()
    for (const loc of locations) {
      await this.client.inventoryLevel.set({ location_id: loc.id, inventory_item_id: inventoryItemId, available: qty })
    }

  }


  productIsArchived (prod) {
    return prod.status === 'archived'
  }


  async _getLocations () {
    // return await this._locationPromise
    return await this.client.location.list()

  }
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = Shopify
