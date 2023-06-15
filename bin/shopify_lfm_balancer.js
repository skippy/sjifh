#!/usr/bin/env node

'use strict'

/*

  FIXMEs:
   - updating is pretty heavy because of the photos;
       perhaps we only update the photo once in awhile
       like after it is unarchived or created?

*/

const yargs = require('yargs')
const logger = require(`${process.mainModule.path}/../src/modules/logger`)
const config = require('../src/config.js')
const _ = require('lodash')
const fetch = require('node-fetch')
const { hideBin } = require('yargs/helpers')
const Shopify = require('../src/shopify')
const LFM = require('../src/lfm')
const limitPromise = import('p-limit')

process.env.TZ = 'UTC'

const QTY_BUFFER = 1

// Set up the command-line interface using yargs
const argv = require('yargs/yargs')(hideBin(process.argv))
  .usage('Usage: $0 <command> [options]')
  .command('products', '# List all LFM products')
  .command('shopify-products', '# List all Shopify products')
  .command('update-shopify', '# update Shopify with LFM products')
  .command('delete-shopify', '# remove all products from Shopify')
  .command('archive-shopify', '# archive all products from Shopify')
  .option('headful', {
    description: 'run in headful mode',
    type: 'boolean',
    default: false
  })
  .option('verbose', {
    description: 'Increase verbosity',
    type: 'count',
    alias: 'v'
  })
  .option('force', { alias: 'f', describe: 'verify cmd' })
  .demandOption([])
  .demandCommand(1, 'You need to specify a command.')
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

async function createShopifyProductStruct (lfmProd, skipImg = false) {
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
  body_html = body_html.replace(/\n/g, '<br>')

  let tags = `SJIFH, ${lfmProd.category}, ${lfmProd.subcategory}, ${lfmProd.producer}`.toUpperCase()
  if (lfmProd.productFrozen) tags += ', FROZEN'
  if (lfmProd.productCold) tags += ', CHILL'

  let qty = parseInt(lfmProd.prAvail) - QTY_BUFFER
  if (qty < 0) qty = 0
  /*  NOTES
        - we need to make sure this is flagged as active
  */
  const shopifyProduct = {
    title: `${lfmProd.prName} (${lfmProd.prUnit})`,
    status: 'active',
    product_type: `${lfmProd.category} / ${lfmProd.subcategory}`,
    tags,
    vendor: config.get('shopify_vendor_name'),
    body_html,
    sku: `puid_${lfmProd.puId}`,
    images: [
      {
        attachment: base64Image
      }
    ],
    variants: [
      {
        price: lfmProd.customerPrice,
        sku: `puid_${lfmProd.puId}`,
        // what about taxable?
        // taxable: false,
        inventory_quantity: qty,
        requires_shipping: false,
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

(async () => {
  let json = ''
  const lfm = new LFM(argv.headful)
  const shopify = new Shopify()

  switch (argv._[0]) {
    case 'products':
      await lfm.login()
      const lfmResult = await lfm.getAvailProducts()
      json = JSON.stringify(lfmResult)
      // prettyJSON = JSON.stringify(lfmProducts, null, 2);
      break
    case 'shopify-products':
      const shopifyResult = await shopify.getAllProducts()
      json = JSON.stringify(shopifyResult)
      break
    case 'archive-shopify':
      await shopify.archiveAllProducts()
      break
    case 'update-shopify':
      const shopifyProducts = await shopify.getAllProducts()
      const shopifyMap = shopifyProducts.reduce((result, item) => {
        const key = _.trimStart(item.variants[0].sku, 'puid_')
        result.set(key, item)
        return result
      }, new Map())

      await lfm.login()
      const lfmProducts = await lfm.getAvailProducts()
      if (lfmProducts.length < 1) {
        logger.verbose('no LFM products visible; archiving all shopify products')
        await shopify.archiveAllProducts()
      } else {
        const { default: limit } = await limitPromise
        const limiter = limit(Shopify.CONCURRENT_API_LIMIT)
        const promises = []

        const reviewedPuIds = new Set()
        const numProducts = lfmProducts.length
        logger.verbose(`creating or updating ${numProducts} shopify products`)
        for (let i = 0; i < numProducts; i++) {
          const lfmProd = lfmProducts[i]
          const existingShopifyProduct = shopifyMap.get(lfmProd.puId.toString())
          const promise = limiter(async () => {
            if (existingShopifyProduct) {
              // modify
              const skipImgDownload = existingShopifyProduct.status === 'active'
              logger.debug(`${i + 1}/${numProducts}: updating shopify product id ${existingShopifyProduct.id} (and img? ${!skipImgDownload})`)
              const shopifyProduct = await createShopifyProductStruct(lfmProd, skipImgDownload)
              shopifyProduct.id = existingShopifyProduct.id
              return shopify.updateProduct(shopifyProduct)
              // return shopify.client.product.update(existingShopifyProduct.id, shopifyProduct)
            } else {
              // insert!
              logger.debug(`${i + 1}/${numProducts}: inserting new shopify product`)
              const shopifyProduct = await createShopifyProductStruct(lfmProd)
              return shopify.createProduct(shopifyProduct)
              // return shopify.client.product.create(shopifyProduct);
            }
          })
          promises.push(promise)
          reviewedPuIds.add(lfmProd.puId.toString())
        }
        await Promise.all(promises)

        // archive all shopify products that don't exist in LFM
        const reviewedPuidKeys = Array.from(reviewedPuIds)
        const missingShopifyProducts = _.values(_.omit(Object.fromEntries(shopifyMap), reviewedPuidKeys))
        if (missingShopifyProducts.length > 0) {
          logger.verbose(`archiving ${missingShopifyProducts.length} shopify products which are not active on LFM`)
          for (const missingShopifyProduct of missingShopifyProducts) {
            logger.verbose(`archiving shopify product id ${missingShopifyProduct.id}: not active on LFM`)
            await shopify.archiveProduct(missingShopifyProduct.id)
          }
        }
      }
      break
    case 'delete-shopify':
      if (!argv.force) {
        console.log('--force required to run this cmd')
        process.exit(1)
      }
      await shopify.deleteAllProducts()
      break
    default:
      console.log(`cmd ${argv._[0]} not recognized`)
      process.exit(1)
  }
  console.log(json)
  process.exit(0)
})()
