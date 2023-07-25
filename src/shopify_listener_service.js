const express = require('express')
const firebaseAdmin = require('firebase-admin')
const _ = require('lodash')
const logger = require('./modules/logger')
const config = require('./config')
const Shopify = require('./shopify')
const LFM = require('./lfm')

logger.level = config.get('log_level')

firebaseAdmin.initializeApp({
  databaseURL: 'https://config.get(\'google_cloud_project\').firebaseio.com'
})
const firebaseDb = firebaseAdmin.firestore()

const app = express()
// some shopify msgs are larger than the 100kb initial limit
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ limit: '5mb', extended: true }))
app.disable('x-powered-by')
// app.use(expressLogger({ format: 'dev' }));

app.post('/', async (req, res) => {
  const message = req.body.message
  if (message.attributes['X-Shopify-Topic'] !== 'orders/updated') {
  // if (message.attributes['X-Shopify-Topic'] !== 'orders/updated' &&
  //    message.attributes['X-Shopify-Topic'] !== 'orders/edited') {
    logger.verbose(`ignoring topic: ${message.attributes['X-Shopify-Topic']}`)
    return res.sendStatus(200)
  }
  logger.debug(`Received Pub/Sub message on topic ${message.attributes['X-Shopify-Topic']}`)
  // logger.debug(`store: ${message.attributes['X-Shopify-Shop-Domain']}`)
  logger.debug(message)
  // logger.verbose(`topic: ${message.attributes['X-Shopify-Topic']}`)
  // logger.debug('message')
  // message['X-Shopify-Topic'] == 'carts/update'
  // 'orders/updated'
  // Process the Pub/Sub message here
  const stringData = Buffer.from(req.body.message.data, 'base64').toString(
    'utf-8'
  )
  const orderData = JSON.parse(stringData)
  logger.debug(orderData)

  // let orderNum, orderItems
  // if (_.get(orderData, 'order_edit')) {
  //   const shopify = new Shopify()
  //   orderData = await shopify.client.order.get(orderData.order_edit.order_id)
  // }
  const orderNum = orderData.order_number
  const orderItems = shopify.findCartItems(orderData)
  if (orderItems.length < 1) {
    // no SJIFH items!  lets skip
    // FIXME: what if they were removed from the cart?
    logger.verbose(`no SJIFH items in Shopify Order ${orderNum}`)
    return res.sendStatus(200)
  }
  logger.verbose(`SJIFH items in Shopify Order ${orderNum}`)

  const docObj = {
    shopify_order_num: orderNum,
    order_items: orderItems,
    shopify_customer_email: orderData.email,
    shopify_msg: orderData,
    created_at: Date.now() / 1000, // unix time seconds
    expires_at: (Date.now() * 10 * 24 * 60 * 60 * 1000) / 1000
  }
  const docRef = firebaseDb.doc(`sjifh-shopify-orders/${orderNum}`)
  const doc = await docRef.get()
  const lfm = new LFM()

  if (doc.exists) {
    logger.verbose(`shopify order already exists: ${orderNum}`)
    const origDocObj = doc.data()
    if (_.isEqual(origDocObj.order_items, docObj.order_items)) {
      logger.verbose('    items equivalent; nothing to do')
    } else {
      // do we need to modify or delete?
      logger.verbose('    items different!')
      await lfm.login()
      // logger.verbose(origDocObj)
      // logger.verbose(docObj)
      for (const newItem of docObj.order_items) {
        const oldItem = origDocObj.order_items.find(i => newItem.shopify_line_item_id === i.shopify_line_item_id)
        const newQty = newItem.qty
        const oldQty = oldItem ? oldItem.qty : null
        logger.debug(`shopify prod #${newItem.shopify_product_id} (puid #${newItem.lfm_puid}): orig qty: ${oldQty} --- new qty: ${newQty}`)
        if (newQty !== oldQty) {
          await lfm.modifyOrder(newItem.lfm_puid, newQty, oldQty)
        }
      }
      await docRef.set(docObj, { merge: true })

      /*
        on canceled items:
         - quantity still 1 (or more)
         - data.financial_status == 'voided'
         - item.fulfillable_quantity == 0
         - data.refunds[0].restock == true
         - data.refunds[0].restock == true
         - data.refunds[0].line_item can be checked for vendor/puid
         - data.refunds[0].quantity == number to be refunded

      */
    }
  } else {
    logger.verbose(`shopify order not previously seen.  adding: ${orderNum}`)
    // - insert
    await lfm.login()
    for (const item of docObj.order_items) {
      const puid = item.lfm_puid
      const qty = item.qty
      await lfm.modifyOrder(item.lfm_puid, qty)
      logger.debug(`item purchased! puid: ${puid} - qty: ${qty} - title: ${item.title}`)
    }
    await docRef.set(docObj, { merge: true })
  }
  lfm.close()
  res.sendStatus(200)
})

app.get('/', (req, res) => {
  // health check
  res.sendStatus(200)
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`)
})

// DEBUG=express:*
