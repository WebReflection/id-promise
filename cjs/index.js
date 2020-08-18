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
const {pid, ppid} = require('process');

const {isMaster} = cluster;
const reject = Promise.reject.bind(Promise);

const CHANNEL = `\x01I'd promise ${isMaster ? pid : ppid}\x01`;
const EXECUTE = 'execute';
const REJECT = 'reject';
const RESOLVE = 'resolve';
const VERIFY = new RegExp(`^${CHANNEL}:`);

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

if (isMaster) {
  const clusters = new Map;
  const send = (workers, worker, uid, message) => {
    clusters.delete(uid);
    for (const id in workers) {
      if (id != worker)
        workers[id].send(message);
    }
  };
  const onMessage = message => {
    /* istanbul ignore else */
    if (typeof message === 'object') {
      const {id: uid, worker, action, error, result} = message;
      /* istanbul ignore else */
      if (typeof uid === 'string' && VERIFY.test(uid)) {
        const {workers} = cluster;
        if (action === EXECUTE) {
          if (!clusters.has(uid)) {
            clusters.set(uid, worker);
            workers[worker].send({id: uid, action});
          }
        }
        else {
          const resolved = action === RESOLVE;
          const key = resolved ? 'result' : 'error';
          const value = resolved ? result : error;
          send(workers, worker, uid, {id: uid, [key]: value, action});
        }
      }
    }
  };
  cluster
    .on('fork', worker => {
      worker.on('message', onMessage);
    })
    .on('exit', (worker, code) => {
      /* istanbul ignore next */
      clusters.forEach((id, uid) => {
        if (id == worker.id) {
          const error = `id ${uid.slice(CHANNEL.length + 1)} failed with code ${code}`;
          send(cluster.workers, id, uid, {id: uid, error, action: REJECT});
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

module.exports = (id, callback) => {
  id = `${CHANNEL}:${id}`;
  return cache.get(id) || set(id, callback, resolvable());
};
