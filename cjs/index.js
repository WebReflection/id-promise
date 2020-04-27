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

const {reject} = Promise;
const {isMaster} = cluster;

const CHANNEL = "\x01I'd promise\x01";
const EXECUTE = 'execute';
const REJECT = 'reject';
const RESOLVE = 'resolve';
const VERIFY = new RegExp(`^${CHANNEL}:`);

const cache = new Map;

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

if (isMaster) {
  const clusters = new Map;
  const onMessage = message => {
    /* istanbul ignore else */
    if (typeof message === 'object') {
      const {id: uid, worker, action, error, result} = message;
      /* istanbul ignore else */
      if (typeof uid === 'string' && VERIFY.test(uid)) {
        const {workers} = cluster;
        if (action === EXECUTE) {
          if (!clusters.has(uid)) {
            clusters.set(uid, resolvable());
            workers[worker].send({id: uid, action});
          }
        }
        else {
          const resolved = action === RESOLVE;
          const key = resolved ? 'result' : /* istanbul ignore next */ 'error';
          const value = resolved ? result : /* istanbul ignore next */ error;
          const promise = clusters.get(uid);
          clusters.delete(uid);
          /* istanbul ignore else */
          if (resolved)
            promise.$(value);
          else
            promise._(value);
          for (const id in workers) {
            /* istanbul ignore else */
            if (id !== worker)
              workers[id].send({id: uid, [key]: value, action});
          }
        }
      }
    }
  };
  cluster.on('fork', worker => {
    worker.on('message', onMessage);
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
      /* istanbul ignore next */
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
      /* istanbul ignore next */
      error => {
        cache.delete(id);
        if (main)
          process.send({id, worker, error, action: REJECT});
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
            /* istanbul ignore next */
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

module.exports = (id, callback) => {
  id = `${CHANNEL}:${id}`;
  return cache.get(id) || set(id, callback, resolvable());
};
