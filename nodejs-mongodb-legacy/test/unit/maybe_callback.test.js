// @ts-nocheck
'use strict';

const sinon = require('sinon');
const { expect } = require('chai');

const mongodbDriver = require('mongodb');
const { MongoDBNamespace } = require('mongodb/lib/utils');
const mongodbLegacy = require('../..');
const { asyncApi } = require('../tools/api');

const classesToMethods = new Map(
  asyncApi.map((api, _, array) => [
    api.className,
    new Set(array.filter(v => v.className === api.className))
  ])
);

const iLoveJs = 'mongodb://iLoveJavascript';
const client = new mongodbLegacy.MongoClient(iLoveJs);
const db = new mongodbLegacy.Db(client, 'animals');
const collection = new mongodbLegacy.Collection(db, 'pets');
const namespace = MongoDBNamespace.fromString('animals.pets');

const OVERRIDDEN_CLASSES_GETTER = new Map([
  ['Admin', () => new mongodbLegacy.Admin(db)],
  ['FindCursor', () => new mongodbLegacy.FindCursor(client, namespace)],
  ['ListCollectionsCursor', () => new mongodbLegacy.ListCollectionsCursor(db, {})],
  ['ListIndexesCursor', () => new mongodbLegacy.ListIndexesCursor(collection)],
  ['AggregationCursor', () => new mongodbLegacy.AggregationCursor(client, namespace)],
  ['ChangeStream', () => new mongodbLegacy.ChangeStream(client)],
  ['GridFSBucket', () => new mongodbLegacy.GridFSBucket(db)],
  ['Collection', () => new mongodbLegacy.Collection(db, 'pets')],
  ['Db', () => new mongodbLegacy.Db(client, 'animals')],
  ['MongoClient', () => new mongodbLegacy.MongoClient(iLoveJs)]
]);

function* generateTests() {
  for (const [className, getInstance] of OVERRIDDEN_CLASSES_GETTER) {
    for (const { method } of classesToMethods.get(className) ?? []) {
      const apiName = `${className}.${method}`;
      const instance = getInstance();
      yield {
        className,
        method,
        instance,
        apiName,
        makeStub: superPromise => {
          return sinon.stub(mongodbDriver[className].prototype, method).returns(superPromise);
        }
      };
    }
  }
}

describe('Maybe Callback', () => {
  afterEach(() => {
    sinon.restore();
  });

  for (const { apiName, instance, method, makeStub } of generateTests()) {
    context(`${apiName}()`, () => {
      it(`returns resolved promise`, async () => {
        // should have a message property to make equality checking consistent
        const superPromise = Promise.resolve({ message: 'success!' });
        makeStub(superPromise);

        expect(instance).to.have.property(method).that.is.a('function');

        const functionLength = instance[method].length;
        const args = Array.from({ length: functionLength - 1 }, (_, i) => i);
        const actualReturnValue = instance[method](...args);

        // should return the same promise the driver returns
        expect(actualReturnValue).to.equal(superPromise);

        // should have a message property to make equality checking consistent
        await superPromise;
        const result = await actualReturnValue.catch(error => error);

        expect(result).to.have.property('message', 'success!');

        const stubbedMethod = Object.getPrototypeOf(Object.getPrototypeOf(instance))[method];
        expect(stubbedMethod).to.have.been.calledOnceWithExactly(...args);
      });

      it('returns rejected promise', async () => {
        const superPromise = Promise.reject(new Error('error!'));
        makeStub(superPromise);

        expect(instance).to.have.property(method).that.is.a('function');

        const functionLength = instance[method].length;
        const args = Array.from({ length: functionLength - 1 }, (_, i) => i);
        const actualReturnValue = instance[method](...args);

        // should return the same promise the driver returns
        expect(actualReturnValue).to.equal(superPromise);

        // awaiting triggers the callback to be called
        await superPromise.catch(error => error);
        const result = await actualReturnValue.catch(error => error);

        expect(result).to.have.property('message', 'error!');

        const stubbedMethod = Object.getPrototypeOf(Object.getPrototypeOf(instance))[method];
        expect(stubbedMethod).to.have.been.calledOnceWithExactly(...args);
      });

      it(`returns void and uses callback(_, result)`, async () => {
        const superPromise = Promise.resolve({ message: 'success!' });
        makeStub(superPromise);

        expect(instance).to.have.property(method).that.is.a('function');

        const callback = sinon.spy();

        const functionLength = instance[method].length;
        const args = Array.from({ length: functionLength }, (_, i) => i);
        args[functionLength - 1] = callback;
        const actualReturnValue = instance[method](...args);

        expect(actualReturnValue).to.be.undefined;

        const returnValue = await superPromise.catch(error => error);
        expect(callback).to.have.been.calledOnce;
        const expectedArgs = callback.args[0];
        expect(expectedArgs).to.have.property('0', undefined);
        expect(expectedArgs).to.have.nested.property('[1].message', returnValue.message);

        const stubbedMethod = Object.getPrototypeOf(Object.getPrototypeOf(instance))[method];
        expect(stubbedMethod).to.have.been.calledOnceWithExactly(
          ...args.slice(0, functionLength - 1)
        );
      });

      it(`returns void and uses callback(error)`, async () => {
        const superPromise = Promise.reject(new Error('error!'));
        makeStub(superPromise);

        expect(instance).to.have.property(method).that.is.a('function');

        const callback = sinon.spy();

        const functionLength = instance[method].length;
        const args = Array.from({ length: functionLength }, (_, i) => i);
        args[functionLength - 1] = callback;
        const actualReturnValue = instance[method](...args);

        expect(actualReturnValue).to.be.undefined;

        const returnValue = await superPromise.catch(error => error);
        expect(callback).to.have.been.calledOnce;
        const expectedArgs = callback.args[0];
        expect(expectedArgs).to.have.nested.property('[0].message', returnValue.message);

        const stubbedMethod = Object.getPrototypeOf(Object.getPrototypeOf(instance))[method];
        expect(stubbedMethod).to.have.been.calledOnceWithExactly(
          ...args.slice(0, functionLength - 1)
        );
      });
    });
  }

  it('calling static MongoClient.connect() returns promise', async () => {
    const returnValue = Promise.resolve(new mongodbDriver.MongoClient(iLoveJs));
    sinon.stub(mongodbDriver.MongoClient, 'connect').returns(returnValue);
    const actualReturnValue = mongodbLegacy.MongoClient.connect(iLoveJs);
    expect(await actualReturnValue).to.be.instanceOf(mongodbLegacy.MongoClient);
  });

  it('calling Collection.rename() returns promise', async () => {
    const returnValue = Promise.resolve(new mongodbDriver.Collection(db, 'a'));
    sinon.stub(mongodbDriver.Collection.prototype, 'rename').returns(returnValue);
    expect(collection).to.have.property('rename').that.is.a('function');
    const actualReturnValue = collection.rename('a');
    expect(await actualReturnValue).to.be.instanceOf(mongodbLegacy.Collection);
  });

  it('calling Db.createCollection() returns promise', async () => {
    const returnValue = Promise.resolve(new mongodbDriver.Collection(db, 'a'));
    sinon.stub(mongodbDriver.Db.prototype, 'createCollection').returns(returnValue);
    expect(db).to.have.property('createCollection').that.is.a('function');
    const actualReturnValue = db.createCollection('a');
    expect(await actualReturnValue).to.be.instanceOf(mongodbLegacy.Collection);
  });

  it('calling Db.collections() returns promise', async () => {
    const returnValue = Promise.resolve([
      new mongodbDriver.Collection(db, 'a'),
      new mongodbDriver.Collection(db, 'b')
    ]);
    sinon.stub(mongodbDriver.Db.prototype, 'collections').returns(returnValue);
    expect(db).to.have.property('collections').that.is.a('function');
    const actualReturnValue = db.collections();
    expect(await actualReturnValue).to.be.an('array');
  });

  it('calling MongoClient.connect() returns promise', async () => {
    const returnValue = Promise.resolve(new mongodbDriver.MongoClient(iLoveJs));
    sinon.stub(mongodbDriver.MongoClient.prototype, 'connect').returns(returnValue);
    expect(client).to.have.property('connect').that.is.a('function');
    const actualReturnValue = client.connect();
    expect(await actualReturnValue).to.be.instanceOf(mongodbLegacy.MongoClient);
  });
});
