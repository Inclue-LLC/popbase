// node_modules の three.js をブラウザ用に vendor/ へコピーする（npm run vendor）
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules/three/build/three.module.min.js');
fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
fs.copyFileSync(src, path.join(root, 'vendor/three.module.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/three/LICENSE'), path.join(root, 'vendor/three.LICENSE'));
console.log('copied three.module.min.js to vendor/');
