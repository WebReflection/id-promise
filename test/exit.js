const cluster = require('cluster');

const idPromise = require('../cjs');

const {fork, isMaster} = cluster;

if (isMaster) {
  fork();
  fork();
  setTimeout(process.exit.bind(process), 2000, 0);
}
else {
  idPromise('exit:ok', res => {
    setTimeout(res, 500, 'id exit:ok was executed');
  }).then(console.log);
  idPromise('exit:error', () => {
    setTimeout(() => { process.exit(1); }, 1000);
  }).catch(console.error);
  idPromise('exit:late', res => {
    setTimeout(res, 1500, 'OK');
  }).catch(console.error);
}
