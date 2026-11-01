// Auto-update QA: stamp-build + studio-update.js reload the page onto a newer deploy ONLY at a safe moment.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

(async () => {
  const root = process.cwd();
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dist-'));
  const files = fs.readFileSync(path.join(root, 'amplify.yml'), 'utf8').match(/cp (index\.html[^\n]*?) dist\//)[1].split(/\s+/);
  for (const f of files) fs.copyFileSync(path.join(root, f), path.join(dist, f));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.copyFileSync(path.join(root, 'assets/library.json'), path.join(dist, 'assets/library.json'));
  execFileSync('node', [path.join(root, 'scripts/stamp-build.cjs'), dist], { stdio: 'pipe' });

  const stamped = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const first = JSON.parse(fs.readFileSync(path.join(dist, 'version.json'), 'utf8')).build;
  assert.ok(!stamped.includes('__BUILD_ID__'), 'placeholder replaced');
  assert.ok(stamped.includes(`<meta name="studio-build" content="${first}">`), 'meta carries the build id');
  assert.ok(stamped.includes(`./studio-update.js?v=${first}`) && stamped.includes(`./studio-pro.css?v=${first}`), 'assets are version-busted');

  const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url || '/').split('?')[0]);
    const abs = path.join(dist, raw === '/' ? 'index.html' : raw.slice(1));
    if (!abs.startsWith(dist) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', mime[path.extname(abs)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(fs.readFileSync(abs));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const setBuild = id => fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify({ build: id }));
  const deploy = id => { fs.writeFileSync(path.join(dist, 'index.html'), fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace(first, id)); setBuild(id); };

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    let loads = 0; page.on('load', () => loads++);
    await page.goto('http://127.0.0.1:' + server.address().port + '/index.html', { waitUntil: 'load' });
    await page.locator('#studioToolNav button[data-tool="scene"]').waitFor();
    assert.equal(await page.evaluate('StudioUpdater.enabled'), true);
    assert.equal(await page.evaluate('StudioUpdater.build'), first);
    assert.equal(await page.evaluate('StudioUpdater.check()'), false, 'same build: nothing to do');

    // a new build while the user is typing: must wait, not reload
    await page.evaluate(() => { const t = document.createElement('textarea'); t.id = 'draft'; t.value = 'unsent'; document.body.append(t); t.focus(); });
    deploy('next-build-1');
    assert.equal(await page.evaluate('StudioUpdater.check()'), true, 'new build detected');
    await page.waitForTimeout(4500);
    assert.equal(loads, 1, 'no reload while typing');
    assert.equal(await page.evaluate('StudioUpdater.busy()'), 'typing');

    // user stops typing -> page updates itself, then runs the NEW build
    await page.evaluate(() => document.getElementById('draft').blur());
    await page.waitForEvent('load', { timeout: 15000 });
    await page.locator('#studioToolNav button[data-tool="scene"]').waitFor();
    assert.equal(await page.evaluate('StudioUpdater.build'), 'next-build-1', 'reloaded onto the new build');
    const settled = loads;
    await page.waitForTimeout(3500);
    assert.equal(loads, settled, 'no reload loop once up to date');
    console.log('PASS auto-update: stamp, detect, wait while typing, reload to latest, no loop');
  } finally { await browser.close(); server.close(); fs.rmSync(dist, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
