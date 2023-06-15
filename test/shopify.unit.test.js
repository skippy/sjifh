const chai = require('chai')
const sinon = require('sinon')

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
    it('should archive all products', () => {
      // Test implementation here
    })
  })

  describe('archiveProduct', () => {
    it('should archive a specific product', () => {
      const shopifyStub = sandbox.stub(instance.client.product, 'update')
      const product = { id: 10, field: 'value' }
      instance.archiveProduct(product.id)
      expect(shopifyStub.calledOnce).to.be.true
      expect(shopifyStub.getCall(0).args.length).to.be.eql(2)
      expect(shopifyStub.getCall(0).args[0]).to.eql(product.id)
      expect(shopifyStub.getCall(0).args[1]).to.eql({ status: 'archived' })
    })
  })

  describe('updateProduct', () => {
    it('should update a specific product', () => {
      const shopifyStub = sandbox.stub(instance.client.product, 'update')
      const product = { id: 10, field: 'value' }
      instance.updateProduct(product)
      expect(shopifyStub.calledOnce).to.be.true
      expect(shopifyStub.getCall(0).args.length).to.be.eql(2)
      expect(shopifyStub.getCall(0).args[0]).to.eql(product.id)
      expect(shopifyStub.getCall(0).args[1]).to.eql(product)
    })
  })

  describe('createProduct', () => {
    it('should create a new product', () => {
      const shopifyStub = sandbox.stub(instance.client.product, 'create')
      const product = { id: 10, field: 'value' }
      instance.createProduct(product)
      expect(shopifyStub.calledOnce).to.be.true
      expect(shopifyStub.getCall(0).args.length).to.be.eql(1)
      expect(shopifyStub.getCall(0).args[0]).to.eql(product)
    })
  })
})
