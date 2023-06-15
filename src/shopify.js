const logger = require('./modules/logger.js')
const config = require('./config.js')
const fetch = require('node-fetch');
const limitPromise = import('p-limit');

const ShopifyApi = require('shopify-api-node');
const _       = require('lodash');
const hostname = `${config.get('shopify_shop_origin')}.myshopify.com`


class Shopify {
  static CONCURRENT_API_LIMIT = 40

  constructor() {
    // this.shopify = new Shopify({
    //   apiKey: process.env.SHOPIFY_API_KEY,
    //   apiSecretKey: process.env.SHOPIFY_ACCESS_TOKEN,
    //   isCustomStoreApp: true,
    //   isEmbeddedApp: false,
    //   shopName: hostname,
    // });
    this.client = new ShopifyApi({
      accessToken: config.get('shopify_access_token'),
      isCustomStoreApp: true,
      isEmbeddedApp: false,
      autoLimit: true,
      shopName: hostname,
    });
  }


// const client = new Shopify({
//   shopName: 'your-shop-name',
//   apiKey: 'your-api-key',
//   password: 'your-api-password',
// });
      // await this.shopify.product.list();

  // async getAllProducts() {
  //   try {

  //     let products = []
  //     // Fetch products from the specific vendor
  //     await this.client.product
  //       .list()
  //       .then(prods => {
  //         products.push(...prods);
  //         _.concat(products, prods);
  //         // Process the retrieved products
  //         // console.log(prods);
  //       })
  //       .catch(err => {
  //         // Handle any errors
  //         console.error(err);
  //       });
  //     return products;
  //   } catch (error) {
  //     console.error('Error retrieving products:', error);
  //   }
  // }


  // async getAllProducts(){
  //   let pageInfo;
  //   do {
  //     const response = await this.client.rest.Product.all({
  //       ...pageInfo?.nextPage?.query,
  //       session,
  //       limit: 10,
  //     });

  //     const pageProducts = response.data;
  //     // ... use pageProducts

  //     pageInfo = response.pageInfo;
  //   } while (pageInfo?.nextPage);
  // }


// (async () => {
//   let params = { limit: 10 };

//   do {
//     const products = await shopify.product.list(params);

//     console.log(products);

//     params = products.nextPageParameters;
//   } while (params !== undefined);
// })().catch(console.error);

  async getAllProducts(block) {
    let options = {
      limit: 250, // Maximum number of products per page (maximum is 250)
      vendor: config.get('shopify_vendor_name')
    };
    const allProducts = []
    let counter = 0
    do {
      const products = await this.client.product.list(options);
      counter += products.length
      if (typeof block === 'function') {
        for (const prod of products) {
          await block(prod);
        }
      } else {
        allProducts.push(...products);
      }
      options = products.nextPageParameters;
    } while (options !== undefined);
    logger.verbose(`retrieved Shopify products: ${counter}`)

    return (typeof block === 'function') ? null : allProducts
  }

  async deleteAllProducts() {
    const { default: limit } = await limitPromise;
    const limiter = limit(Shopify.CONCURRENT_API_LIMIT);
    const promises =[]
    await this.getAllProducts((product) => {
      const promise = limiter(() => {
        logger.debug(`deleting shopify product id ${product.id}`)
        return this.client.product.delete(product.id)
      })
      promises.push(promise)
      // await this.client.product.delete(product.id)
    })
    await Promise.all(promises);
  }

  async archiveAllProducts() {
    const { default: limit } = await limitPromise;
    const limiter = limit(Shopify.CONCURRENT_API_LIMIT);
    const promises =[]
    await this.getAllProducts((product) => {
      if(product.status === 'archived') return
      const promise = limiter(() => {
        logger.debug(`archiving shopify product id ${product.id}`)
        return this.client.product.update(product.id, {status: 'archived'})
      })
      promises.push(promise)
    })
    await Promise.all(promises);
  }

  async archiveProduct(prodId) {
    return await this.client.product.update(prodId, {status: 'archived'})
  }

  async updateProduct(prod){
    return await this.client.product.update(prod.id, prod)
  }

  async createProduct(prod){
    return await this.client.product.create(prod);
  }



}


module.exports = Shopify;
