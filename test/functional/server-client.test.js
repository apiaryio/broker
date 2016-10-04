// process.stdout.write('\033c'); // clear the screen
const tap = require('tap');
const test = require('tap-only');
const path = require('path');
const request = require('request');
const app = require('../../lib');
const root = __dirname;

const { port, echoServerPort } = require('../utils')(tap);

test('proxy requests originating from behind the broker server', t => {
  /**
   * 1. start broker in server mode
   * 2. start broker in client mode and join (1)
   * 3. run local http server that replicates "private server"
   * 4. send requests to **server**
   *
   * Note: client is forwarding requests to echo-server defined in test/util.js
   */

  process.env.ACCEPT = 'filters.json';

  process.chdir(path.resolve(root, '../fixtures/server'));
  process.env.BROKER_TYPE = 'server';
  const serverPort = port();
  const server = app.main({ port: serverPort });

  process.chdir(path.resolve(root, '../fixtures/client'));
  process.env.BROKER_TYPE = 'client';
  process.env.BROKER_TOKEN = '12345';
  process.env.BROKER_SERVER_URL = `http://localhost:${serverPort}`;
  process.env.ORIGIN_PORT = echoServerPort;
  const client = app.main({ port: port() });


  // wait for the client to successfully connect to the server and identify itself
  server.io.on('connection', socket => {
    socket.on('identify', token => {
      t.plan(12);

      const headers = { 'X-Broker-Authorization': token };

      t.test('successfully broker POST', t => {
        const url = `http://localhost:${serverPort}/broker/echo-body`;
        const body = { some: { example: 'json' }};
        request({ url, method: 'post', json: true, body, headers  }, (err, res) => {
          t.equal(res.statusCode, 200, '200 statusCode');
          t.same(res.body, body, 'body brokered');
          t.end();
        });
      });

      t.test('successfully broker exact bytes of POST body', t => {
        const url = `http://localhost:${serverPort}/broker/echo-body`;
        // stringify the JSON unusually to ensure an unusual exact body
        const body = Buffer.from(
          JSON.stringify({ some: { example: 'json' }}, null, 5)
        );
        const headersWithContentType = Object.assign(
          { 'Content-Type': 'application/json' }, headers
        );
        request({ url, method: 'post', body, headers: headersWithContentType }, (err, res) => {
          const responseBody = Buffer.from(res.body);
          t.equal(res.statusCode, 200, '200 statusCode');
          t.same(responseBody, body, 'body brokered exactly');
          t.end();
        });
      });

      t.test('successfully broker GET', t => {
        const url = `http://localhost:${serverPort}/broker/echo-param/xyz`;
        request({ url, method: 'get', headers }, (err, res) => {
          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(res.body, 'xyz', 'body brokered');
          t.end();
        });
      });

      // the variable substitution takes place in the broker client
      t.test('variable subsitution', t => {
        const url = `http://localhost:${serverPort}/broker/echo-body`;
        const body = {
          BROKER_VAR_SUB: ['swap.me'],
          swap: { me: '${BROKER_TYPE}:${BROKER_TOKEN}' },
        };
        request({ url, method: 'post', json: true, body, headers  }, (err, res) => {
          const swappedBody = {
            BROKER_VAR_SUB: ['swap.me'],
            swap: { me: 'client:12345' },
          };
          t.equal(res.statusCode, 200, '200 statusCode');
          t.same(res.body, swappedBody, 'body brokered');
          t.end();
        });
      })

      // the filtering happens in the broker client
      t.test('block request for non-whitelisted url', t => {
        const url = `http://localhost:${serverPort}/broker/not-allowed`;
        request({ url, 'method': 'post', json: true, headers }, (err, res, body) => {
          t.equal(res.statusCode, 401, '401 statusCode');
          t.equal(body, 'blocked', '"blocked" body: ' + body);
          t.end();
        });
      });

      // the filtering happens in the broker client
      t.test('allow request for valid url with valid body', t => {
        const url = `http://localhost:${serverPort}/broker/echo-body/filtered`;
        const body = { proxy: { me: 'please' }};
        request({ url, method: 'post', json: true, body, headers  }, (err, res) => {
          t.equal(res.statusCode, 200, '200 statusCode');
          t.same(res.body, body, 'body brokered');
          t.end();
        });
      });

      // the filtering happens in the broker client
      t.test('block request for valid url with invalid body', t => {
        const url = `http://localhost:${serverPort}/broker/echo-body/filtered`;
        const body = { proxy: { me: 'now!' }};
        request({ url, 'method': 'post', json: true, body, headers }, (err, res, body) => {
          t.equal(res.statusCode, 401, '401 statusCode');
          t.equal(body, 'blocked', '"blocked" body: ' + body);
          t.end();
        });
      });

      t.test('bad broker token', t => {
        const url = `http://localhost:${serverPort}/broker/echo-body`;
        const badAuthHeaders = { 'X-Broker-Authorization': 'nonsense' };
        request({ url, 'method': 'post', json: true, badAuthHeaders }, (err, res) => {
          t.equal(res.statusCode, 401, '401 statusCode');
          t.end();
        });
      });

      t.test('missing broker token', t => {
        const url = `http://localhost:${serverPort}/broker/echo-body`;
        request({ url, 'method': 'post', json: true }, (err, res) => {
          t.equal(res.statusCode, 401, '401 statusCode');
          t.end();
        });
      });

      // don't leak broker tokens to systems on the client side
      t.test('broker token is not included in headers from client to private', t => {
        const url = `http://localhost:${serverPort}/broker/echo-headers`;
        request({ url, method: 'post', headers }, (err, res) => {
          const responseBody = JSON.parse(res.body);
          t.equal(res.statusCode, 200, '200 statusCode');
          t.equal(responseBody['x-broker-token'], undefined, 'X-Broker-Token header not sent');
          t.equal(responseBody['x-broker-authorization'], undefined, 'X-Broker-Authorization header not sent');
          t.end();
        });
      });

      t.test('querystring parameters are brokered', t => {
        const url = `http://localhost:${serverPort}/broker/echo-query?shape=square&colour=yellow`;
        request({ url, method: 'get', headers }, (err, res) => {
          const responseBody = JSON.parse(res.body);
          t.equal(res.statusCode, 200, '200 statusCode');
          t.same(responseBody, {shape: 'square', colour: 'yellow'},
            'querystring brokered');
          t.end();
        });
      });

      t.test('clean up', t => {
        client.close();
        setTimeout(() => {
          server.close();
          t.ok('sockets closed');
          t.end();
        }, 100);
      });
    });
  });
});
