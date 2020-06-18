'use strict';
/*!
 * ISC License
 *
 * Copyright (c) 2020, Andrea Giammarchi, @WebReflection
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
 * OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
const cluster = (m => m.__esModule ? /* istanbul ignore next */ m.default : /* istanbul ignore next */ m)(require('cluster'));
const {randomBytes} = require('crypto');

const {isMaster} = cluster;
const reject = Promise.reject.bind(Promise);

const BOOTSTRAP = "\x01I'd promise\x01";
const EXECUTE = 'execute';
const REJECT = 'reject';
const RESOLVE = 'resolve';

const cache = new Map;

const getError = error => typeof error == 'object' ?
  {message: error.message, stack: error.stack} :
  /* istanbul ignore next */
  String(error)
;

const resolvable = () => {
  let $, _;
  const promise = new Promise((resolve, reject) => {
    $ = resolve;
    _ = reject;
  });
  promise.$ = $;
  promise._ = _;
  return promise;
};

let CHANNEL;

if (isMaster) {
  const channel = '\x01' + randomBytes(16).toString('hex');
  const verify = new RegExp(`^${channel}:`);
  const clusters = new Set;
  const onMessage = message => {
    /* istanbul ignore else */
    if (typeof message === 'object') {
      const {id: uid, worker, action, error, result} = message;
      /* istanbul ignore else */
      if (typeof uid === 'string' && verify.test(uid)) {
        const {workers} = cluster;
        if (action === EXECUTE) {
          if (!clusters.has(uid)) {
            clusters.add(uid);
            workers[worker].send({id: uid, action});
          }
        }
        else {
          const resolved = action === RESOLVE;
          const key = resolved ? 'result' : 'error';
          const value = resolved ? result : error;
          clusters.delete(uid);
          for (const id in workers) {
            if (id != worker)
              workers[id].send({id: uid, [key]: value, action});
          }
        }
      }
    }
  };
  CHANNEL = Promise.resolve(channel);
  cluster.on('fork', worker => {
    worker.on('message', onMessage);
    worker.send({[BOOTSTRAP]: channel});
  });
}
else {
  CHANNEL = new Promise(res => {
    process.on('message', function channel(message) {
      /* istanbul ignore else */
      if (BOOTSTRAP in message) {
        process.removeListener('message', channel);
        res(message[BOOTSTRAP]);
      }
    });
  });
}

const set = (id, callback, promise) => {
  const {$, _} = promise;
  if (isMaster) {
    cache.set(id, promise = promise.then(
      result => {
        cache.delete(id);
        return result;
      },
      error => {
        cache.delete(id);
        return reject(error);
      }
    ));
    callback($, _);
  }
  else {
    let main = false;
    const worker = cluster.worker.id;
    cache.set(id, promise = promise.then(
      result => {
        cache.delete(id);
        if (main)
          process.send({id, worker, result, action: RESOLVE});
        return result;
      },
      error => {
        cache.delete(id);
        if (main)
          process.send({id, worker, error: getError(error), action: REJECT});
        return reject(error);
      }
    ));
    process.on('message', function listener(message) {
      /* istanbul ignore else */
      if (typeof message === 'object') {
        const {id: uid, action, error, result} = message;
        /* istanbul ignore else */
        if (uid === id) {
          process.removeListener('message', listener);
          switch (action) {
            case EXECUTE:
              main = true;
              callback($, _);
              break;
            case RESOLVE:
              $(result);
              break;
            case REJECT:
              _(error);
              break;
          }
        }
      }
    });
    process.send({id, worker, action: EXECUTE});
  }
  return promise;
};

module.exports = (id, callback) => CHANNEL.then(
  channel => cache.get(`${channel}:${id}`) ||
  set(`${channel}:${id}`, callback, resolvable())
);
