const convict = require('convict')
const convict_format_with_validator = require('convict-format-with-validator')
const yaml = require('js-yaml')

require('dotenv').config()

convict.addParser({ extension: ['yml', 'yaml'], parse: yaml.load })
convict.addFormats(convict_format_with_validator)

// Define a schema
const config = convict({
  env: {
    doc: 'The application environment.',
    format: ['production', 'development', 'test'],
    default: 'development',
    arg: 'nodeEnv',
    env: 'NODE_ENV'
  },
  log_level: {
    format: ['debug', 'verbose', 'info', 'warn', 'error'],
    default: 'info',
    env: 'LOG_LEVEL',
    arg: 'log_level'
  },
  lfm_username: {
    format: '*',
    default: null,
    sensitive: true,
    required: true,
    env: 'LFM_USERNAME'
  },
  lfm_password: {
    format: '*',
    default: null,
    sensitive: true,
    required: true,
    env: 'LFM_PASSWORD'
  },
  shopify_access_token: {
    format: '*',
    default: null,
    sensitive: true,
    required: true,
    env: 'SHOPIFY_ACCESS_TOKEN'
  },
  shopify_shop_origin: {
    format: String,
    default: null,
    required: true,
    env: 'SHOPIFY_SHOP_ORIGIN'
  },
  shopify_vendor_name: {
    format: String,
    default: null,
    required: true,
    env: 'SHOPIFY_VENDOR_NAME'
  },
  shopify_price_min: {
    format: Number,
    default: null,
    env: 'SHOPIFY_PRICE_MIN'
  },
  shopify_qty_buffer: {
    format: Number,
    default: null,
    env: 'SHOPIFY_QTY_BUFFER'
  },
  firebase_collection_name: {
    format: String,
    default: null,
    env: 'FIREBASE_COLLECTION_NAME'
  },
  google_cloud_project: {
    format: String,
    default: null,
    env: 'GOOGLE_CLOUD_PROJECT'
  },
  gcp_pubsub_address: {
    format: String,
    default: null,
    env: 'GCP_PUBSUB_ADDRESS'
  }
})

// Load environment dependent configuration
const env = config.get('env')
config.loadFile('./config/default.json')
// config.loadFile('config/app_configs.yml')
// config.loadFile(`./config/${env}.json`)
// Perform validation
config.validate({ allowed: 'strict' })

module.exports = config
// export default config
