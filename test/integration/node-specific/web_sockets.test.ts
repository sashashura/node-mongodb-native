import { expect, util } from 'chai';

import {
  BSON,
  CommandFailedEvent,
  CommandStartedEvent,
  CommandSucceededEvent,
  MongoClient,
  ObjectId
} from '../../../src';
import { OP_MSG } from '../../../src/cmap/wire_protocol/constants';
import { MongoDBNamespace } from '../../../src/utils';
import { ejson, sleep } from '../../tools/utils';

type MinimalSocketInterface = {
  remoteAddress: string;
  remotePort: number;
  setKeepAlive: (enable: boolean, initialDelayMS: number) => void;
  setTimeout: (timeoutMS: number) => void;
  setNoDelay: (noDelay: boolean) => void;
  pipe: <T extends NodeJS.WritableStream = any>(stream: T) => void;
  on: (eventName: string, listener: (event: any) => void) => void;
  once: (eventName: string, listener: (event: any) => void) => void;
  emit: (eventName: string) => void;
  write: (chunk: any) => void;
  removeAllListeners: (eventName: string) => void;
  removeListener: (eventName: string) => void;
  end: (callback: () => void) => void;
  destroy: () => void;
};

class WS implements MinimalSocketInterface {
  #options: any;
  #logger: { log: (m: string) => void };
  #stream: NodeJS.WritableStream;
  remoteAddress: string;
  remotePort: number;

  myHello = {
    helloOk: true,
    isWritablePrimary: true,
    topologyVersion: { processId: new ObjectId(), counter: 0 },
    maxBsonObjectSize: 16777216,
    maxMessageSizeBytes: 48000000,
    maxWriteBatchSize: 100000,
    localTime: new Date(),
    logicalSessionTimeoutMinutes: 30,
    connectionId: 85,
    minWireVersion: 0,
    maxWireVersion: 17,
    readOnly: false,
    ok: 1
  };
  #client: MongoClient;

  constructor(options) {
    this.remoteAddress = 'hello';
    this.remotePort = 2323;
    this.#options = options;
    this.#logger = {
      log:
        (() => null) ??
        (m => {
          console.log(m);
          console.log();
        })
    };

    this.#client = new MongoClient('mongodb://localhost:27017');
  }

  setKeepAlive(enable: boolean, initialDelayMS: number) {
    this.#logger.log(ejson`setKeepAlive(${enable}, ${initialDelayMS})`);
    return;
  }

  setTimeout(timeoutMS: number) {
    this.#logger.log(ejson`setTimeout(${timeoutMS})`);
    return;
  }

  setNoDelay(noDelay: boolean) {
    this.#logger.log(ejson`setNoDelay(${noDelay})`);
    return;
  }

  on(eventName: string, listener: (event: any) => void) {
    this.#logger.log(ejson`on(${eventName}, listener)`);
    return;
  }

  once(eventName: string, listener: (event: any) => void) {
    this.#logger.log(ejson`once(${eventName}, listener)`);
    if (eventName === 'connect') {
      process.nextTick(listener);
    }
    return;
  }

  pipe<T extends NodeJS.WritableStream>(stream: T) {
    this.#logger.log(ejson`pipe(stream)`);
    this.#stream = stream;
  }

  emit(eventName: string) {
    this.#logger.log(ejson`emit(${eventName})`);
  }

  #receiveMessageFromDriver(message: Buffer) {
    const messageHeader = {
      length: message.readInt32LE(0),
      requestId: message.readInt32LE(4),
      responseTo: message.readInt32LE(8),
      opCode: message.readInt32LE(12),
      flags: message.readInt32LE(16)
    };

    if (messageHeader.opCode !== OP_MSG) {
      const nsNullTerm = message.indexOf(0x00, 20);
      const ns = message.toString('utf8', 20, nsNullTerm);
      const nsLen = nsNullTerm - 20 + 1;
      const numberToSkip = message.readInt32LE(20 + nsLen);
      const numberToReturn = message.readInt32LE(20 + nsLen + 4);
      const docStart = 20 + nsLen + 4 + 4;
      const docLen = message.readInt32LE(docStart);
      const doc = BSON.deserialize(message.subarray(docStart, docStart + docLen));
      return {
        ...messageHeader,
        ns,
        numberToSkip,
        numberToReturn,
        doc
      };
    } else {
      const payloadType = message.readUint8(20);
      const docStart = 20 + 1;
      const docLen = message.readInt32LE(docStart);
      const doc = BSON.deserialize(message.subarray(docStart, docStart + docLen));
      return {
        ...messageHeader,
        payloadType,
        doc
      };
    }
  }

  #sendResponseToDriver(message, response) {
    const responseBytes = BSON.serialize(response);
    const payloadTypeBuffer = Buffer.alloc(1, 0);
    const headers = Buffer.alloc(20);
    headers.writeInt32LE(0, 4);
    headers.writeInt32LE(message.requestId, 8);
    headers.writeInt32LE(OP_MSG, 12);
    headers.writeInt32LE(0, 16);
    const bufferResponse = Buffer.concat([headers, payloadTypeBuffer, responseBytes]);
    bufferResponse.writeInt32LE(bufferResponse.byteLength, 0);
    process.nextTick(() => this.#stream.write(bufferResponse));
  }

  write(bytes: Buffer) {
    this.#logger.log(ejson`write(${bytes.byteLength})`);
    const message = this.#receiveMessageFromDriver(bytes);
    const { doc } = message;
    this.#logger.log(ejson`wrote(${message.doc})`);

    if (doc.hello || doc.ismaster) {
      return this.#sendResponseToDriver(message, this.myHello);
    }

    this.#logger.log(ejson`CMD ${doc}`);

    // HERE: pass doc along to a websocket, along with credentials
    // on the we server side, do some authn authz
    // should require minimal parsing / modification of "doc"

    // ws.binaryType = 'arrayBuffer'
    // ws.send(doc)

    // HERE: await a reply from the ws server, ideally it's the exact BSON
    // the server returned (not OP_MSG) but that's okay
    // wrap up the BSON in an OP_MSG of our own making that has the correct fields
    // set for the driver logic to follow (responseTo)

    // const serverResponse = await ws.onMessage()
    // this.#sendResponseToDriver(message, serverResponse)

    if (doc.endSessions) {
      return this.#client
        .db('admin')
        .command(doc)
        .then(
          res => this.#client.close().then(() => res),
          error =>
            this.#sendResponseToDriver(message, { ok: 0, errmsg: error.message, code: error.code })
        )
        .then(res => this.#sendResponseToDriver(message, res));
    }

    return this.#client
      .db(doc.$db ?? 'admin')
      .command(doc)
      .then(
        res => this.#sendResponseToDriver(message, res),
        error =>
          this.#sendResponseToDriver(message, { ok: 0, errmsg: error.message, code: error.code })
      );
  }

  removeAllListeners(eventName: string) {
    this.#logger.log(ejson`removeAllListeners(${eventName})`);
    return;
  }

  removeListener(eventName: string) {
    this.#logger.log(ejson`removeListener(${eventName})`);
    return;
  }

  end(callback) {
    process.nextTick(callback);
  }

  destroy() {
    return;
  }
}

function createWebsocket(options): MinimalSocketInterface {
  return new WS(options);
}

describe.only('Connect to a websocket', () => {
  let client: MongoClient;
  let started: CommandStartedEvent[];
  let succeeded: CommandSucceededEvent[];
  let failed: CommandFailedEvent[];
  beforeEach(async function () {
    const utilClient = this.configuration.newClient();
    await utilClient
      .db('vet')
      .collection('pets')
      .drop()
      .catch(() => null);
    await utilClient
      .db('vet')
      .collection<{ _id: string; cute: true }>('pets')
      .insertOne({ _id: 'spot', cute: true });
    await utilClient.close();

    client = this.configuration.newClient(
      { monitorCommands: true },
      { [Symbol.for('@@mdb.websocket')]: createWebsocket }
    );
    started = [];
    client.on('commandStarted', ev => started.push(ev));
    succeeded = [];
    client.on('commandSucceeded', ev => succeeded.push(ev));
    failed = [];
    client.on('commandFailed', ev => failed.push(ev));
  });

  afterEach(async function () {
    client?.removeAllListeners();
    // @ts-expect-error: intentionally risk null exception to prevent leaking across tests
    started = null;
    // @ts-expect-error: intentionally risk null exception to prevent leaking across tests
    succeeded = null;
    // @ts-expect-error: intentionally risk null exception to prevent leaking across tests
    failed = null;
    await client?.close();
  });

  it('should create a "websocket" connection', async () => {
    await client.connect();
    const pets = client.db('vet').collection<{ _id: string; cute: true }>('pets');

    const cutePet = await pets.findOne({ cute: true });
    expect(cutePet).to.have.property('cute', true);

    const newPetInsert = await pets.insertOne({ _id: 'lola', cute: true });
    expect(newPetInsert).to.have.property('insertedId');
  });
});
