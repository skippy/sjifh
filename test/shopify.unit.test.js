const chai = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const _ = require('lodash')
const expect = chai.expect
const sandbox = sinon.createSandbox()

// // Import the functions to be tested
// const {
//   getAllProducts,
//   deleteAllProducts,
//   archiveAllProducts,
//   archiveProduct,
//   updateProduct,
//   createProduct
// } = require('../src/shopify');

const Shopify = require('../src/shopify')

let sampleCleanLFMProducts = require('./data/lfm_cleaned_products.json')
let sampleShopifyProducts = require('./data/shopify_products.json')
let sampleShopifyLocations = require('./data/shopify_locations.json')

describe('Shopify Unit Tests', () => {
  let instance

  before(() => {
    instance = new Shopify()
  })

  beforeEach(() => {
  //   //NOTE: reload before every test, as we modify the data structure
  //   sampleShopifyProducts = require('./data/shopify_products.json')
  //   sampleShopifyLocations = require('./data/shopify_locations.json')
  // //   twilioMsgsStub = sandbox.stub(sms, '_sendTwilioMsg').returns({})
  })

  afterEach(() => {
    sandbox.restore()
  })


  describe('getAllProducts', () => {
    it('should return an array of all products', () => {
      // Test implementation here
    })
  })


//   describe('deleteAllProducts', () => {
//     it('should delete all products', async () => {
//       const products = [{id: 1}, {id: 2}]
//       const shopifyDeleteStub = sandbox.stub(instance.client.product, 'delete')
//       sandbox.stub(instance, 'getAllProducts').returns(products)
// console.log('-------------------')
//       await instance.deleteAllProducts()
// console.log('-------------------finished')

//       expect(shopifyDeleteStub.calls).to.be.eql(2)


//       // Test implementation here
//     })
//   })


  // async deleteAllProducts () {
  //   const { default: limit } = await limitPromise
  //   const limiter = limit(Shopify.CONCURRENT_API_LIMIT)
  //   const promises = []
  //   await this.getAllProducts((product) => {
  //     const promise = limiter(() => {
  //       logger.debug(`deleting shopify product id ${product.id}`)
  //       return this.client.product.delete(product.id)
  //     })
  //     promises.push(promise)
  //     // await this.client.product.delete(product.id)
  //   })
  //   await Promise.all(promises)
  // }


  describe('archiveAllProducts', () => {
    // beforeEach(() => {
    //   sandbox.stub(instance.client.product, 'list').returns(sampleShopifyProducts)
    // })

    it('should archive all products', async () => {
      sandbox.stub(instance.client.product, 'list').returns(sampleShopifyProducts)
      const shopifyStub = sandbox.stub(instance.client.product, 'update')
      await instance.archiveAllProducts()
      expect(sampleShopifyProducts.length).to.be.greaterThan(1)
      expect(shopifyStub.callCount).to.equal(sampleShopifyProducts.length)
      for (let i = 0; i < sampleShopifyProducts.length; i++) {
        expect(shopifyStub.getCall(i).args.length).to.be.eql(2)
        expect(shopifyStub.getCall(i).args[0]).to.eql(sampleShopifyProducts[i].id)
        expect(shopifyStub.getCall(i).args[1]).to.eql({ status: 'archived' })
      }
    })

    it('should skip the update if the product is already archived', async () => {
      const sampleShopifyProductsArchived = _.cloneDeep(sampleShopifyProducts)
      for (const prod of sampleShopifyProductsArchived) {
        prod.status = 'archived'
      }
      sandbox.stub(instance.client.product, 'list').returns(sampleShopifyProductsArchived)
      const shopifyStub = sandbox.stub(instance.client.product, 'update')
      await instance.archiveAllProducts()
      expect(shopifyStub.callCount).to.eql(0)
    })
  })


  describe('archiveProduct', () => {
    it('should archive a specific product', async () => {
      const shopifyStub = sandbox.stub(instance.client.product, 'update')
      const product = { id: 10, field: 'value' }
      await instance.archiveProduct(product.id)
      expect(shopifyStub.calledOnce).to.be.true
      expect(shopifyStub.getCall(0).args.length).to.be.eql(2)
      expect(shopifyStub.getCall(0).args[0]).to.eql(product.id)
      expect(shopifyStub.getCall(0).args[1]).to.eql({ status: 'archived' })
    })
  })


  describe('updateProduct', () => {
    it('should update a specific product, including updating inventory levels with a direct api call rather than setting the deprecated inventory_quantity', async () => {
      sandbox.stub(instance.client.location, 'list').returns(sampleShopifyLocations)

      const product = _.cloneDeep( sampleShopifyProducts[0] )
      // set quantity to 2
      product
      const shopifyUpdateStub = sandbox.stub(instance.client.product, 'update').returns(product)
      const shopifyInventoryLevelSetStub = sandbox.stub(instance.client.inventoryLevel, 'set')

      await instance.updateProduct(product)

      expect(shopifyUpdateStub.calledOnce).to.be.true
      expect(shopifyUpdateStub.getCall(0).args.length).to.be.eql(2)
      expect(shopifyUpdateStub.getCall(0).args[0]).to.eql(product.id)
      //equal MINUS the quantity
      delete product.variants[0].inventory_quantity
      expect(shopifyUpdateStub.getCall(0).args[1]).to.eql(product)

      expect(shopifyInventoryLevelSetStub.calledOnce).to.be.true
      expect(shopifyInventoryLevelSetStub.getCall(0).args.length).to.be.eql(1)
      expect(shopifyInventoryLevelSetStub.getCall(0).args[0].location_id).to.eql(sampleShopifyLocations[0].id)
      expect(shopifyInventoryLevelSetStub.getCall(0).args[0].inventory_item_id).to.eql(product.variants[0].inventory_item_id)
      expect(shopifyInventoryLevelSetStub.getCall(0).args[0].available).to.eql(2)
    })
  })


  describe('createProduct', () => {
    it('should create a new product, including setting inventory levels with a direct api call rather than setting the deprecated inventory_quantity, as well as setting shipping to false', async () => {
      sandbox.stub(instance.client.location, 'list').returns(sampleShopifyLocations)

      const product = sampleShopifyProducts[0]
      const shopifyStub = sandbox.stub(instance.client.product, 'create').returns(product)
      const shopifyInventoryLevelSetStub = sandbox.stub(instance.client.inventoryLevel, 'set')
      const shopifyInventoryItemUpdateStub = sandbox.stub(instance.client.inventoryItem, 'update')

      await instance.createProduct(product)

      expect(shopifyStub.calledOnce).to.be.true
      expect(shopifyStub.getCall(0).args.length).to.be.eql(1)
      //equal MINUS the quantity
      const prodCopy = _.cloneDeep( product )
      delete prodCopy.variants[0].inventory_quantity
      expect(shopifyStub.getCall(0).args[0]).to.eql(prodCopy)

      expect(shopifyInventoryLevelSetStub.calledOnce).to.be.true
      expect(shopifyInventoryLevelSetStub.getCall(0).args.length).to.be.eql(1)
      expect(shopifyInventoryLevelSetStub.getCall(0).args[0].location_id).to.eql(sampleShopifyLocations[0].id)
      expect(shopifyInventoryLevelSetStub.getCall(0).args[0].inventory_item_id).to.eql(product.variants[0].inventory_item_id)
      expect(shopifyInventoryLevelSetStub.getCall(0).args[0].available).to.eql(2)

      expect(shopifyInventoryItemUpdateStub.calledOnce).to.be.true
      expect(shopifyInventoryItemUpdateStub.getCall(0).args.length).to.be.eql(2)
      expect(shopifyInventoryItemUpdateStub.getCall(0).args[0]).to.eql(product.variants[0].inventory_item_id)
      expect(shopifyInventoryItemUpdateStub.getCall(0).args[1]).to.eql({ requires_shipping: false })
    })
  })

  describe('createProductStructFromLFM', () => {
    let cleanLFMProducts

    beforeEach(() => {
      cleanLFMProducts = _.cloneDeep( sampleCleanLFMProducts )
    })

    describe('titles', async () => {
      it('the title should start with product name', async () => {
        const lfmProduct = _.find(cleanLFMProducts, ['puId', 6609])
        const output = await instance.createProductStructFromLFM(lfmProduct, true)
        expect(output.title).to.match(new RegExp(`^${lfmProduct.prName}`))
      })

      it('the title should end with [SJIFH]', async () => {
        const lfmProduct = _.find(cleanLFMProducts, ['puId', 6609])
        const output = await instance.createProductStructFromLFM(lfmProduct, true)
        expect(output.title).to.match(/\[SJIFH\]$/)
      })

      it('the title should contain the producer name', async () => {
        const lfmProduct = _.find(cleanLFMProducts, ['puId', 6609])
        const output = await instance.createProductStructFromLFM(lfmProduct, true)
        expect(output.title).to.match(new RegExp(lfmProduct.producer))
      })

      it('should have an expected title with a box product unit', async () => {
        const lfmProduct = _.find(cleanLFMProducts, ['puId', 6609])
        const output = await instance.createProductStructFromLFM(lfmProduct, true)
        expect(output.title).to.equal('Chard, Rainbow (5 lb) Watmough Bay Farm [SJIFH]')
      })

      it('should have an expected title with a lbs range', async () => {
        const lfmProduct = _.find(cleanLFMProducts, ['puId', 5954])
        const output = await instance.createProductStructFromLFM(lfmProduct, true)
        expect(output.title).to.equal("Beef Steak, New York (0.50-0.60) Sundstrom's Little S [SJIFH]")
      })

      it('should have an expected title with a non-standard unit size', async () => {
        const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
        const output = await instance.createProductStructFromLFM(lfmProduct, true)
        expect(output.title).to.equal("Bouquet, Cut Flowers (Medium Bouquet) Baba Yaga Farm [SJIFH]")
      })

    })

    it('should set the status to active', async () => {
      const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
      const output = await instance.createProductStructFromLFM(lfmProduct, true)
      expect(output.status).to.equal('active')
    })


    it('should set the product_type to the LFM category and sub category', async () => {
      const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
      const output = await instance.createProductStructFromLFM(lfmProduct, true)
      expect(output.product_type).to.equal(`${lfmProduct.category} / ${lfmProduct.subcategory}`)
    })

    it('should set SJIFH as a tag', async () => {
      const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
      const output = await instance.createProductStructFromLFM(lfmProduct, true)
      expect(output.tags).to.include('SJIFH')
    })

    it('should set SAN JUAN ISLANDS FOOD HUB as a tag', async () => {
      const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
      const output = await instance.createProductStructFromLFM(lfmProduct, true)
      expect(output.tags).to.include('SAN JUAN ISLANDS FOOD HUB')
    })

    it('should set category as a tag', async () => {
      const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
      const output = await instance.createProductStructFromLFM(lfmProduct, true)
      expect(output.tags).to.include(lfmProduct.category.toUpperCase())
    })

    it('should set subCategory as a tag', async () => {
      const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
      const output = await instance.createProductStructFromLFM(lfmProduct, true)
      expect(output.tags).to.include(lfmProduct.subcategory.toUpperCase())
    })

    it('should set the vendor as the producer', async () => {
      const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
      const output = await instance.createProductStructFromLFM(lfmProduct, true)
      expect(output.vendor).to.equal(lfmProduct.producer)
    })

    it('should set the sku as the LFM puid', async () => {
      const lfmProduct = _.find(cleanLFMProducts, ['puId', 14582])
      const output = await instance.createProductStructFromLFM(lfmProduct, true)
      expect(output.sku).to.equal(`puid_${lfmProduct.puId}`)
    })

  })


  describe('findCartItems', () => {
    let sampleCreateOrder = require('./data/shopify_order_create_decoded_msg.json')

    it('should find LFM items', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems).to.have.lengthOf(2)
      expect(foundItems[0].sku).to.equal('puid_6200')
      expect(foundItems[1].sku).to.equal('puid_6609')
    })

    it('should contain sku in the expected format', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems[0]).to.have.property('sku')
      expect(foundItems[0].sku).to.match(/^puid_\d+$/)
      expect(foundItems[1].sku).to.match(/^puid_\d+$/)
    })

    it('should contain lfm_puid in the expected format', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems[0]).to.have.property('lfm_puid')
      expect(foundItems[1]).to.have.property('lfm_puid')
      expect(foundItems[0].lfm_puid).to.match(/^\d+$/)
      expect(`puid_${foundItems[0].lfm_puid}`).to.equal(foundItems[0].sku)
      expect(foundItems[1].lfm_puid).to.match(/^\d+$/)
      expect(`puid_${foundItems[1].lfm_puid}`).to.equal(foundItems[1].sku)
    })

    it('should contain item_price in the expected format', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems[0]).to.have.property('item_price')
      expect(foundItems[0].item_price).to.match(/^\d+\.\d+$/)
      expect(foundItems[1].item_price).to.match(/^\d+\.\d+$/)
    })

    it('should contain shopify_line_item_id', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems[0]).to.have.property('shopify_line_item_id')
      expect(foundItems[1]).to.have.property('shopify_line_item_id')
      expect(foundItems[0].shopify_line_item_id).to.match(/^\d+$/)
      expect(foundItems[1].shopify_line_item_id).to.match(/^\d+$/)
    })

    it('should contain shopify_product_id', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems[0]).to.have.property('shopify_product_id')
      expect(foundItems[1]).to.have.property('shopify_product_id')
      expect(foundItems[0].shopify_product_id).to.match(/^\d+$/)
      expect(foundItems[1].shopify_product_id).to.match(/^\d+$/)
    })

    it('should contain shopify_variant_id', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems[0]).to.have.property('shopify_variant_id')
      expect(foundItems[1]).to.have.property('shopify_variant_id')
      expect(foundItems[0].shopify_variant_id).to.match(/^\d+$/)
      expect(foundItems[1].shopify_variant_id).to.match(/^\d+$/)
    })

    it('should contain qty', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems[0]).to.have.property('qty')
      expect(foundItems[1]).to.have.property('qty')
      expect(foundItems[0].qty).to.match(/^\d+$/)
      expect(foundItems[1].qty).to.match(/^\d+$/)
    })

    it('should contain title', () => {
      const foundItems = instance.findCartItems(sampleCreateOrder)
      expect(foundItems[0]).to.have.property('title')
      expect(foundItems[1]).to.have.property('title')
    })
  })

  // describe('createProductStruct', () => {
  //   let productStruct
  //   beforeEach(async () => {
  //     productStruct = await instance.createProductStruct('my title', 'product type', ['tag1', 'tag2'], 'my vendor', '<p>my desc</p>', 'sku_123445', null, 20.20, 2)
  //   })


  //   it('create an expected Shopify product structure', async () => {
  //     const expectedProductKeys = ['title', 'status', 'product_type', 'tags', 'vendor', 'bodyHtml', 'sku', 'variants']
  //     expect(_.keys(productStruct).sort()).to.eql(expectedProductKeys.sort())
  //     // const expectedProductStruct = {
  //     //   title: 'my title',
  //     //   status: 'active',
  //     //   product_type: 'product type',
  //     //   tags: [ 'TAG1', 'TAG2' ],
  //     //   vendor: 'vendor',
  //     //   bodyHtml: '<p>my desc</p>',
  //     //   sku: 'sku_123445',
  //     //   variants: [
  //     //     {
  //     //       price: 20.2,
  //     //       sku: 'sku_123445',
  //     //       taxable: false,
  //     //       inventory_quantity: 2,
  //     //       inventory_management: 'shopify'
  //     //     }
  //     //   ]
  //     // }
  //     // expect(productStruct).to.eql(expectedProductStruct)
  //   })

  //   it('upper cases the tags', async () => {
  //     expect(productStruct.tags).to.eql(['TAG1', 'TAG2'])
  //   })

  //   it('sets the title', async () => {
  //     expect(productStruct.title).to.eql('my title')
  //   })

  //   it('sets the status to active', async () => {
  //     expect(productStruct.status).to.eql('active')
  //   })

  //   it('sets the product_type', async () => {
  //     expect(productStruct.product_type).to.eql('product type')
  //   })

  //   it('sets the vendor', async () => {
  //     expect(productStruct.vendor).to.eql('my vendor')
  //   })

  //   it('sets the bodyHtml', async () => {
  //     expect(productStruct.bodyHtml).to.eql('<p>my desc</p>')
  //   })

  //   it('sets the sku', async () => {
  //     expect(productStruct.sku).to.eql('sku_123445')
  //   })

  //   it('sets the variants sub-structure', async () => {
  //     expect(productStruct.variants).to.eql([{
  //       price: 20.2,
  //       sku: 'sku_123445',
  //       taxable: false,
  //       inventory_quantity: 2,
  //       inventory_management: 'shopify'
  //     }])
  //   })




  // })


})
