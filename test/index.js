const cluster = require('cluster');

const idPromise = require('../cjs');

const {fork, isMaster} = cluster;

let samePromiseCalls = 0;
const samePromise = () => idPromise('id-promise:timer', res => {
  setTimeout(res, 300, ++samePromiseCalls);
});

let errorsCalls = 0;
const rejectingPromise = () => idPromise('id-promise:throw', (_, rej) => {
  setTimeout(() => {
    rej(new Error(++errorsCalls));
  }, 600);
});

if (isMaster) {
  Promise.all([
    samePromise(),
    samePromise(),
    samePromise()
  ])
  .then(([a, b, c]) => {
    console.log('master', a);
    console.assert(a == 1 && b === a && c === a, 'master works');
  });
  Promise.all([
    rejectingPromise(),
    rejectingPromise()
  ]).catch(error => {
    console.log('master error', error.message);
    console.assert(error.message == 1, 'master can reject');
  });
  fork();
  fork();
  fork();
}
else {
  samePromise().then(
    result => {
      console.log('worker', result);
      console.assert(result === 1, 'worker works');
    }
  );
  rejectingPromise().catch(error => {
    console.log('worker error', error.message);
    console.assert(error.message == 1, 'worker can reject');
    setTimeout(() => {
      cluster.worker.kill();
    }, 900);
  });
}
