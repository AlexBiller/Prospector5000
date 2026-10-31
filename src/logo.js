'use strict';
const { raw } = require('./html');

const GRID_X = [-30, -5, 18, 42, 65, 90];

function logo({ id = 'lg', height = 44, label = 'Prospector5000' } = {}) {
  const lines = GRID_X.map((x) => `<line x1="30" y1="38" x2="${x}" y2="62"/>`).join('');
  return raw(`<svg class="logo" role="img" aria-label="${label}" viewBox="0 0 280 62" height="${height}" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="${id}-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe66d"/><stop offset=".55" stop-color="#ff6ec7"/><stop offset="1" stop-color="#a239ff"/></linearGradient>
<linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12002b"/><stop offset="1" stop-color="#3b0a5c"/></linearGradient>
<linearGradient id="${id}-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#bcd0ff"/><stop offset=".5" stop-color="#2b3a7a"/><stop offset=".56" stop-color="#ff9bf0"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
<mask id="${id}-bars"><rect width="60" height="62" fill="#fff"/><rect y="27" width="60" height="1.5" fill="#000"/><rect y="31" width="60" height="2.2" fill="#000"/><rect y="35.5" width="60" height="3" fill="#000"/></mask>
<clipPath id="${id}-tile"><rect x="1" y="1" width="58" height="60" rx="10"/></clipPath>
<filter id="${id}-glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<g clip-path="url(#${id}-tile)">
<rect width="60" height="62" fill="url(#${id}-sky)"/>
<circle cx="30" cy="30" r="19" fill="url(#${id}-sun)" mask="url(#${id}-bars)"/>
<rect y="38" width="60" height="24" fill="#12002b"/>
<g stroke="#00f0ff" stroke-width="1" opacity=".85">${lines}<line x1="0" y1="38" x2="60" y2="38" stroke="#ff2bd6" stroke-width="1.4"/><line x1="0" y1="42" x2="60" y2="42"/><line x1="0" y1="48" x2="60" y2="48"/><line x1="0" y1="56" x2="60" y2="56"/></g>
</g>
<rect x="1" y="1" width="58" height="60" rx="10" fill="none" stroke="#ff2bd6" stroke-width="1.5" filter="url(#${id}-glow)"/>
<text x="72" y="37.5" textLength="204" lengthAdjust="spacingAndGlyphs" font-family="'Arial Black','Helvetica Neue',Impact,sans-serif" font-weight="900" font-style="italic" font-size="27" fill="#ff2bd6" opacity=".55" filter="url(#${id}-glow)">PROSPECTOR</text>
<text x="70" y="35" textLength="204" lengthAdjust="spacingAndGlyphs" font-family="'Arial Black','Helvetica Neue',Impact,sans-serif" font-weight="900" font-style="italic" font-size="27" fill="url(#${id}-chrome)" stroke="#1b0638" stroke-width=".9">PROSPECTOR</text>
<text x="206" y="58" textLength="66" lengthAdjust="spacingAndGlyphs" transform="rotate(-6 240 52)" font-family="'Brush Script MT','Segoe Script',cursive" font-style="italic" font-weight="700" font-size="22" fill="none" stroke="#ff3df0" stroke-width="1.4" filter="url(#${id}-glow)">5000</text>
<text x="206" y="58" textLength="66" lengthAdjust="spacingAndGlyphs" transform="rotate(-6 240 52)" font-family="'Brush Script MT','Segoe Script',cursive" font-style="italic" font-weight="700" font-size="22" fill="#ffe6fb">5000</text>
</svg>`);
}

const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe66d"/><stop offset=".6" stop-color="#ff6ec7"/><stop offset="1" stop-color="#a239ff"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#12002b"/><circle cx="32" cy="30" r="20" fill="url(#s)"/><g fill="#12002b"><rect y="29" width="64" height="2"/><rect y="34" width="64" height="3"/><rect y="40" width="64" height="24"/></g><g stroke="#00f0ff" stroke-width="2"><line x1="0" y1="46" x2="64" y2="46"/><line x1="0" y1="55" x2="64" y2="55"/><line x1="32" y1="40" x2="4" y2="64"/><line x1="32" y1="40" x2="60" y2="64"/><line x1="32" y1="40" x2="32" y2="64"/></g><line x1="0" y1="40" x2="64" y2="40" stroke="#ff2bd6" stroke-width="2.5"/></svg>`);

module.exports = { logo, FAVICON };
