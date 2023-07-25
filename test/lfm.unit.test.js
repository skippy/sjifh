const chai = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const _ = require('lodash')
const expect = chai.expect
const sandbox = sinon.createSandbox()

const LFM = require('../src/lfm')

let sampleRawLFMProducts = require('./data/lfm_raw_products.json')
// let sampleShopifyLocations = require('./data/shopify_locations.json')

describe('LFM Unit Tests', () => {
  let instance

  before(() => {
    instance = new LFM()
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

  //not really public, but it has business logic we want to test
  describe('_cleanupProducts', () => {
	  let rawLFMProducts

	  beforeEach(() => {
	    rawLFMProducts = _.cloneDeep( sampleRawLFMProducts )
	  })

	  describe('removing products', () => {
		  it('should remove items which are hidden', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 8945])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 8945])
	    	expect(rawProduct).to.not.be.undefined
	    	expect(cleanedProduct).to.be.undefined
	    })

	    it('should remove items have zero qty listed, sold, or available', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 14561])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 14561])
	    	expect(rawProduct).to.not.be.undefined
	    	expect(cleanedProduct).to.be.undefined
	    })

	    it('should remove items where the producer is on vacation', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 8954])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 8954])
	    	expect(rawProduct).to.not.be.undefined
	    	expect(cleanedProduct).to.be.undefined
	    })
	  })

    describe('setting pricing', () => {
    	it('should update customer price to max price based upon on weight', () => {
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 14562])
	    	expect(cleanedProduct.customerPricePerLbs).to.equal(8.96)
	    	expect(cleanedProduct.customerPrice).to.equal(11.2)
	    	expect(cleanedProduct.puWeight).to.equal(1.25)
    	})

    	it('should show original customer price for an item with no weight', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 14576])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 14576])
	    	expect(cleanedProduct.customerPrice).to.equal(44.8)
	    	expect(cleanedProduct.customerPrice).to.equal(rawProduct.customerPrice)
	    	expect(cleanedProduct.puWeight).to.be.undefined
	    	expect(cleanedProduct.customerPricePerLbs).to.be.undefined
    	})

    	it('should show original customer price for a C item', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 14564])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 14564])
	    	expect(cleanedProduct.customerPrice).to.equal(13.51)
	    	expect(cleanedProduct.customerPrice).to.equal(rawProduct.customerPrice)
	    	expect(cleanedProduct.puWeight).to.be.undefined
	    	expect(cleanedProduct.customerPricePerLbs).to.be.undefined
    	})

    	it('should show original customer price for an A item', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 10004])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 10004])
	    	expect(cleanedProduct.customerPrice).to.equal(8.69)
	    	expect(cleanedProduct.customerPrice).to.equal(rawProduct.customerPrice)
	    	expect(cleanedProduct.puWeight).to.be.undefined
	    	expect(cleanedProduct.customerPricePerLbs).to.be.undefined
    	})

    	it('should include a per lbs if the weight is set and above 1', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 14562])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 14562])
	    	expect(cleanedProduct.customerPrice).to.equal(11.2)
	    	expect(cleanedProduct.puWeight).to.equal(1.25)
	    	expect(cleanedProduct.customerPricePerLbs).to.equal(8.96)
    	})

    	it('should include a per lbs if the weight is set and above 2', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 13468])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 13468])
	    	expect(cleanedProduct.customerPrice).to.equal(56.7)
	    	expect(cleanedProduct.puWeight).to.equal(4.5)
	    	expect(cleanedProduct.customerPricePerLbs).to.equal(12.6)
    	})

    	it('should include a per lbs if the weight is set and below 1', () => {
	    	const rawProduct = _.find(rawLFMProducts, ['puId', 5954])
	    	const products = instance._cleanupProducts(rawLFMProducts)
	    	const cleanedProduct = _.find(products, ['puId', 5954])
	    	expect(cleanedProduct.customerPrice).to.equal(18.82)
	    	expect(cleanedProduct.puWeight).to.equal(0.6)
	    	expect(cleanedProduct.customerPricePerLbs).to.equal(31.36)
    	})

    })

    it('trims whitespace from the name', () => {
    	const rawProduct = _.find(rawLFMProducts, ['puId', 5954])
    	const products = instance._cleanupProducts(rawLFMProducts)
    	const cleanedProduct = _.find(products, ['puId', 5954])
    	expect(rawProduct.prName).to.equal('Beef Steak, New York ')
    	expect(cleanedProduct.prName).to.equal('Beef Steak, New York')
    })
  })


})
