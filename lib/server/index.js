const debug = require('debug')('broker:server');
const socket = require('./socket');
const relay = require('../relay');

module.exports = ({ config = {}, port = null, filters = {} }) => {
  debug('running');

  // start the local webserver to listen for relay requests
  const { app, server } = require('../webserver')(config, port);

  // bind the socket server to the web server
  const { io, connections } = socket({
    server,
    filters: filters.private,
    config,
  });

  app.all('/broker/*', (req, res, next) => {

    debug(req.headers);
    const token = req.headers['x-broker-authorization'];

    // check if we have this broker in the connections
    if (!connections.has(token)) {
      debug('no broker found matching "%s"', token);
      return res.status(401).send();
    }

    res.locals.io = connections.get(token);

     // strip the leading url
    req.url = req.url.slice(`/broker`.length);
    debug('request for %s', req.url);

    next();
  }, relay.request(filters.public));

  return {
    io,
    close: done => {
      debug('closing');
      server.close();
      io.destroy(done || (() => debug('closed')));
    },
  };
};
