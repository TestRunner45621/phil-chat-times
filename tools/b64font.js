// b64font.js — emit an @font-face rule embedding the nameplate TTF as base64.
// Usage: node tools/b64font.js > tools/nameplate-font.css
'use strict';
const fs = require('fs');
const path = require('path');
const ttf = path.join(__dirname, '..', 'Instructions', 'fonts', 'UnifrakturMaguntia-Book.ttf');
const b64 = fs.readFileSync(ttf).toString('base64');
process.stdout.write(`@font-face{font-family:"UnifrakturMaguntia";src:url(data:font/ttf;base64,${b64}) format("truetype");font-weight:normal;font-style:normal;font-display:block}\n`);
