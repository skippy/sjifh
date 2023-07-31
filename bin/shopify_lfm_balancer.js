#!/usr/bin/env node

'use strict'

/*

  FIXMEs:
   - updating is pretty heavy because of the photos;
       perhaps we only update the photo once in awhile
       like after it is unarchived or created?

*/

const yargs = require('yargs')
const logger = require('../src/modules/logger')
const config = require('../src/config.js')
const _ = require('lodash')
const fetch = require('node-fetch')
const { hideBin } = require('yargs/helpers')
const Shopify = require('../src/shopify')
const LFM = require('../src/lfm')
const limitPromise = import('p-limit')

process.env.TZ = 'UTC'

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function validLFMProducts (lfm, ignore_closed_period) {
  await lfm.login()
  const minPrice = config.get('shopify_price_min')
  const products = await lfm.getAvailProducts(ignore_closed_period)
  _.remove(products, (item) => {
    if (item.customerPrice < minPrice){
      logger.verbose(`removing item because below min price: ${item.puId} (${item.customerPrice} < ${minPrice}`)
      return true
    }
    return false
  })
  return products
}

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
  .option('ignore-closed-period', {
    description: 'ignore whether the products are from a closed period or not',
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


(async () => {
  let json = ''
  const lfm = new LFM(argv.headful)
  const shopify = new Shopify()

  switch (argv._[0]) {
    case 'products':
      const lfmResult = await validLFMProducts(lfm, argv['ignore-closed-period'])
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
      await lfm.login()
      const lfmProducts = await validLFMProducts(lfm, argv['ignore-closed-period'])
      if (lfmProducts.length < 1) {
        logger.verbose('no LFM products visible; archiving all shopify products')
        await shopify.archiveAllProducts()
      } else {
        const { default: limit } = await limitPromise
        const limiter = limit(Shopify.CONCURRENT_API_LIMIT)
        const promises = []
        const shopifyProducts = await shopify.getAllProducts()
        const shopifyMap = shopifyProducts.reduce((result, item) => {
          const key = _.trimStart(item.variants[0].sku, 'puid_')
          result.set(key, item)
          return result
        }, new Map())

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
              const shopifyProduct = await shopify.createProductStructFromLFM(lfmProd, skipImgDownload)
              shopifyProduct.id = existingShopifyProduct.id
              // await shopify.updateProduct(shopifyProduct)
              // console.log('-----------')
              // console.log(shopify.client.callLimits)
              // const ratioRemaining = shopify.client.callLimits.remaining/shopify.client.callLimits.max
              // if(ratioRemaining < 0.50){
              //   console.log('delaying!!!!')
              //   delay(500)
              // }
              // await delay(500)
              // await shopify.updateProduct(shopifyProduct)
              return shopify.updateProduct(shopifyProduct)
              // return shopify.client.product.update(existingShopifyProduct.id, shopifyProduct)
            } else {
              // insert!
              logger.debug(`${i + 1}/${numProducts}: inserting new shopify product`)
              const shopifyProduct = await shopify.createProductStructFromLFM(lfmProd)
              // await shopify.createProduct(shopifyProduct)
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
            if (shopify.productIsArchived(missingShopifyProduct)) {
              logger.debug(`shopify product id ${missingShopifyProduct.id}: already archived`)
            } else {
              logger.debug(`archiving shopify product id ${missingShopifyProduct.id}: not active on LFM`)
              await shopify.archiveProduct(missingShopifyProduct.id)
            }
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
