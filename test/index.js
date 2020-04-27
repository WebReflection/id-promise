const cluster = require('cluster');

const idPromise = require('../cjs');

const {fork, isMaster} = cluster;

let samePromiseCalls = 0;
const samePromise = () => idPromise('id-promise:timer', res => {
  setTimeout(res, 300, ++samePromiseCalls);
});

if (isMaster) {
  Promise.all([
    samePromise(),
    samePromise(),
    samePromise()
  ])
  .then(([a, b, c]) => {
    console.log('master', a);
    console.assert(a === 1 && b === a && c === a, 'master works');
  });
  fork();
  fork();
  fork();
}
else {
  samePromise().then(
    result => {
      console.log('worker', result);
      console.assert(result === 1, 'master works');
      cluster.worker.kill();
    }
  );
}
