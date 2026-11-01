// Run by Amplify AFTER files are copied into dist/ (see amplify.yml).
// 1) creates a unique build id, 2) writes dist/version.json, 3) stamps dist/index.html:
//    - <meta name="studio-build"> gets the id (the running page knows which build it is)
//    - local ./*.js / ./*.css get ?v=<id> so a new deploy can never be served from a stale browser cache
const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve(process.argv[2] || 'dist');
const commit = String(process.env.AWS_COMMIT_ID || process.env.GITHUB_SHA || 'local').slice(0, 7);
const id = `${commit}-${Date.now().toString(36)}`;

const indexPath = path.join(dist, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('__BUILD_ID__')) throw new Error('index.html is missing the __BUILD_ID__ placeholder');
html = html.replace('__BUILD_ID__', id);
html = html.replace(/((?:src|href)=")(\.\/[\w.\-]+\.(?:js|css))(")/g, `$1$2?v=${id}$3`);
fs.writeFileSync(indexPath, html);

fs.writeFileSync(
  path.join(dist, 'version.json'),
  JSON.stringify({ build: id, builtAt: new Date().toISOString() })
);
console.log('Story Studio build', id);
