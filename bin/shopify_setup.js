#!/usr/bin/env node
'use strict';

require("dotenv").config();
require("@shopify/shopify-api/adapters/node")
const Shopify = require('@shopify/shopify-api');

const hostname = `${process.env.SHOP_ORIGIN}.myshopify.com`
//NOTE: this doesn't work for some reason
// const shopifyRestResources = require("@shopify/shopify-api/rest/admin/2023-01").restResources
const { restResources } = require("@shopify/shopify-api/rest/admin/2023-01")

const shopify = Shopify.shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_ACCESS_TOKEN,
  isCustomStoreApp: true,
  isEmbeddedApp: false,
  hostName: hostname,
  // Mount REST resources.
  restResources
});

const session = shopify.session.customAppSession(hostname);

const topics = ['carts/update', 'orders/edited', 'orders/updated']

topics.forEach(t => {
  let webhook = new shopify.rest.Webhook({session: session})
  webhook.address = process.env.GCP_PUBSUB_ADDRESS
  webhook.topic   = t
  webhook.format  = 'json'
  webhook.save({update: true})
})


await shopify.rest.Webhook.all({
  session: session,
});

