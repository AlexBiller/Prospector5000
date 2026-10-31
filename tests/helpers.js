'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-'));
  return path.join(dir, 'test.db');
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function mockServer(handler) {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    req.body = body;
    handler(req, res);
  });
  return server;
}

class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.bodies = []; }
  async req(method, p, form, headers = {}) {
    const h = { origin: this.base, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(this.base + p, { method, headers: h, body, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    this.bodies.push(text + JSON.stringify([...res.headers]));
    return { status: res.status, location: res.headers.get('location'), text, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, form) { return this.req('POST', p, form || {}); }
  async login(pw) { return this.post('/login', { password: pw }); }
}

module.exports = { tmpDb, listen, mockServer, Client };
