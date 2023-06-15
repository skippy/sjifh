const chai = require('chai')
const sinon = require('sinon')
const fs = require('fs');
const _ = require('lodash');
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

let sampleShopifyProducts = require('./data/shopify_products.json');

describe('Shopify Unit Tests', () => {
  let instance

  before(() => {
    instance = new Shopify()
  })

  // beforeEach(() => {
  //   twilioMsgsStub = sandbox.stub(sms, '_sendTwilioMsg').returns({})
  // })

  afterEach(() => {
    sandbox.restore()
  })

  describe('getAllProducts', () => {
    it('should return an array of all products', () => {
      // Test implementation here
    })
  })

  describe('deleteAllProducts', () => {
    it('should delete all products', () => {
      // Test implementation here
    })
  })

  describe('archiveAllProducts', () => {
    // beforeEach(() => {
    //   sandbox.stub(instance.client.product, 'list').returns(sampleShopifyProducts)
    // })

    it('should archive all products', async () => {
      sandbox.stub(instance.client.product, 'list').returns(sampleShopifyProducts)
      const shopifyStub = sandbox.stub(instance.client.product, 'update')
      await instance.archiveAllProducts()
      expect(sampleShopifyProducts.length).to.be.greaterThan(1);
      expect(shopifyStub.callCount).to.equal(sampleShopifyProducts.length)
      for (let i = 0; i < sampleShopifyProducts.length; i++) {
        expect(shopifyStub.getCall(i).args.length).to.be.eql(2)
        expect(shopifyStub.getCall(i).args[0]).to.eql(sampleShopifyProducts[i].id)
        expect(shopifyStub.getCall(i).args[1]).to.eql({ status: 'archived' })
      }
    })

    it('should skip the update if the product is already archived', async () => {
      const sampleShopifyProductsArchived = _.cloneDeep(sampleShopifyProducts);
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
    it('should update a specific product', async () => {
      const shopifyStub = sandbox.stub(instance.client.product, 'update')
      const product = { id: 10, field: 'value' }
      await instance.updateProduct(product)
      expect(shopifyStub.calledOnce).to.be.true
      expect(shopifyStub.getCall(0).args.length).to.be.eql(2)
      expect(shopifyStub.getCall(0).args[0]).to.eql(product.id)
      expect(shopifyStub.getCall(0).args[1]).to.eql(product)
    })
  })

  describe('createProduct', () => {
    it('should create a new product', async () => {
      const shopifyStub = sandbox.stub(instance.client.product, 'create')
      const product = { id: 10, field: 'value' }
      await instance.createProduct(product)
      expect(shopifyStub.calledOnce).to.be.true
      expect(shopifyStub.getCall(0).args.length).to.be.eql(1)
      expect(shopifyStub.getCall(0).args[0]).to.eql(product)
    })
  })
})
