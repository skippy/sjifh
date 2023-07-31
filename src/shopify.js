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


  // async createProductStruct (title, productType, tagsArr, vendor, bodyHtml, sku, imgUrl, price, qty) {
  //   let base64Image
  //   if (imgUrl) {
  //     const fetchResponse = await fetch(imgUrl)
  //     const imgBbuffer = await fetchResponse.buffer()
  //     base64Image = Buffer.from(imgBbuffer).toString('base64')
  //   }

  //   _.forEach(tagsArr, (tag, index) => {
  //     tagsArr[index] =  tag.toUpperCase();
  //   });

  //   if (qty < 0) qty = 0

  //   const shopifyProduct = {
  //     title: title,
  //     status: 'active',
  //     product_type: productType,
  //     tags: tagsArr,
  //     vendor: vendor,
  //     bodyHtml,
  //     sku: sku,
  //     images: [
  //       {
  //         attachment: base64Image
  //       }
  //     ],
  //     variants: [
  //       {
  //         price: price,
  //         sku: sku,
  //         // what about taxable?
  //         taxable: false,
  //         inventory_quantity: qty,
  //         // requires_shipping: false,
  //         inventory_management: 'shopify'
  //         // what about weight unit?!
  //         // weight: _.isEmpty(lfmProd.puWeight) ? null : parseFloat(lfmProd.puWeight),
  //       }
  //     ]
  //   }
  //   if (!base64Image) {
  //     delete shopifyProduct.images
  //   }
  //   return shopifyProduct
  // }


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

      let product
      try {
        product = await this.client.product.create(prodCopy)
      } catch (e) {
        logger.error('failed creating product')
        logger.error(prodCopy)
        throw e
      }

      try {
        await this.client.inventoryItem.update(prodCopy.variants[0].inventory_item_id, { requires_shipping: false })
      } catch (e) {
        logger.error('failed updating inventory to no shipping on product')
        logger.error(prodCopy)
        throw e
      }

      try {
        await this._setInventoryLevel(prodCopy.variants[0].inventory_item_id, qty)
      } catch (e) {
        logger.error(`failed updating inventory levels on product to ${qty}`)
        logger.error(prodCopy)
        throw e
      }

    })()
  }


  async createProductStructFromLFM (lfmProd, skipImg = false) {
    let base64Image
    if (!skipImg) {
      const fetchResponse = await fetch(lfmProd.productImgUrl)
      const imgBbuffer = await fetchResponse.buffer()
      base64Image = Buffer.from(imgBbuffer).toString('base64')
    }
    let body_html = ''
    if (!/^\s*$/.test(lfmProd.productTagline)) {
      body_html += `<p>${lfmProd.productTagline}</p>`
    }
    if (!/^\s*$/.test(lfmProd.productDesc)) {
      body_html += `<p>${lfmProd.productDesc}</p>`
    }
    body_html += `<p>Producer: ${lfmProd.producer}</p>`
    body_html = body_html.replace(/\n/g, '<br>')

    // let tags = `${config.get('shopify_default_product_tags')}, ${lfmProd.category}, ${lfmProd.subcategory}`.toUpperCase()
    // if (lfmProd.productFrozen) tags += ', FROZEN'
    // if (lfmProd.productCold) tags += ', CHILL'

    const tags = _.concat(config.get('shopify_default_product_tags'), lfmProd.category, lfmProd.subcategory)
    _.forEach(tags, (tag, index) => {
      tags[index] =  tag.toUpperCase();
    });
    if (lfmProd.productFrozen) tags.push('FROZEN')
    if (lfmProd.productCold) tags.push('CHILL')


    let qty = parseInt(lfmProd.prAvail) - config.get('shopify_qty_buffer')
    if (qty < 0) qty = 0
    /*  NOTES
          - we need to make sure this is flagged as active
    */
    const origPrice = parseFloat(lfmProd.customerPrice)
    const shopifyProduct = {
      title: `${lfmProd.prName} (${lfmProd.prUnit}) ${lfmProd.producer} ${config.get('shopify_product_title_append_txt')}`.trim().replace(/\s+/g,' '),
      status: 'active',
      product_type: `${lfmProd.category} / ${lfmProd.subcategory}`,
      tags: tags,
      vendor: lfmProd.producer,
      body_html,
      //NOTE: do NOT modify the sku, specifically the 'puid_' part; we use that to match
      //      items from the cart
      sku: `puid_${lfmProd.puId}`,
      images: [
        {
          attachment: base64Image
        }
      ],
      variants: [
        {
          price: origPrice + (origPrice * config.get('shopify_markup_add')),
          sku: `puid_${lfmProd.puId}`,
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


  findCartItems (orderData) {
    const lineItems = orderData.line_items.filter(item => item.sku && item.sku.match(/^puid_/))
    const orderItems = lineItems.map(item => ({
      sku: item.sku,
      lfm_puid: item.sku.split('puid_')[1],
      item_price: item.price,
      shopify_line_item_id: item.id,
      shopify_product_id: item.product_id,
      shopify_variant_id: item.variant_id,
      title: item.title,
      // use this isntead of qty; qty is what was asked for,
      // but fulfillable_quantity shows actual amt delivered
      // (taking into account edits and deletions)
      // orig_qty: item.quantity,
      qty: item.fulfillable_quantity
    }))
    return orderItems
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
