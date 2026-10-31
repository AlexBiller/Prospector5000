'use strict';
// Captures a PNG/JPEG of the live demo for the prospect PDF: Devin's reported screenshot_url first,
// then the configured screenshot service (SCREENSHOT_SERVICE, `{url}` = demo URL). All fetches go through the SSRF-safe client.
const net = require('./net');
const config = require('./config');
const { safeUrl } = require('./html');

const isImage = (b) => !!b && b.length > 8 &&
  ((b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff));

function sources(a) {
  const out = [];
  if (safeUrl(a.screenshot_url)) out.push(a.screenshot_url);
  if (config.report.screenshotService && safeUrl(a.demo_url)) out.push(config.report.screenshotService.replace('{url}', a.demo_url));
  return out;
}

async function capture(a) {
  for (const u of sources(a)) {
    try {
      const r = await net.fetchBuffer(u, { maxBytes: 6000000, timeoutMs: 45000 });
      if (isImage(r.buffer)) return r.buffer;
    } catch { /* try the next source */ }
  }
  return null;
}

module.exports = { capture, isImage, sources };
