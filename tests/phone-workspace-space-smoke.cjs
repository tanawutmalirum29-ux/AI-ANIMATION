// Phone QA: the tool panel must keep real working room (v19 layout) and nothing may overflow sideways.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = process.cwd();
  const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = raw === '/' ? 'index.html' : raw.slice(1);
    const abs = path.resolve(root, file);
    if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(abs));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const [width, height, minShare] of [[360, 717, .33], [390, 844, .38], [412, 915, .40]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'load' });
      await page.locator('#studioToolNav button[data-tool="scene"]').waitFor();
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => {
        const r = s => document.querySelector(s).getBoundingClientRect().toJSON();
        return { cls: document.body.className, body: r('#studioToolBody'), pre: r('#pre'), stage: r('#stage'), ctl: r('#ctl'),
          scene: r('#sceneSwitchBar'), nav: r('#studioToolNav'), tl: r('#tl'), docW: document.documentElement.scrollWidth, innerW: innerWidth };
      });
      assert.ok(m.cls.includes('pre-side'), 'a 9:16 stage sits beside the controls on a portrait phone');
      assert.ok(m.body.height >= height * minShare, `tool panel keeps room: ${Math.round(m.body.height)}px of ${height}px`);
      assert.ok(m.stage.right <= m.ctl.left + 1, 'stage and controls do not overlap');
      assert.ok(m.ctl.bottom <= m.scene.top + 1, 'scene bar sits below the transport');
      assert.ok(Math.abs(m.nav.top - m.pre.bottom) < 4, 'tool tabs follow the preview');
      assert.ok(m.docW <= m.innerW, 'no horizontal page overflow');
      // clock text never sits under a button
      const clash = await page.evaluate(() => {
        const c = document.querySelector('#clock').getBoundingClientRect();
        return [...document.querySelectorAll('#ctl>button')].some(b => { const x = b.getBoundingClientRect(); return x.left < c.right - 1 && x.right > c.left + 1 && x.top < c.bottom - 1 && x.bottom > c.top + 1; });
      });
      assert.equal(clash, false, 'clock does not overlap transport buttons');
      // landscape project falls back to stacked layout but stays compact
      await page.evaluate(() => { S.project.aspect = '16:9'; render(); });
      await page.waitForTimeout(250);
      const wide = await page.evaluate(() => ({ cls: document.body.className, body: document.querySelector('#studioToolBody').getBoundingClientRect().height }));
      assert.ok(!wide.cls.includes('pre-side') && wide.body >= height * .24, 'stacked fallback keeps room for a 16:9 project: ' + Math.round(wide.body));
      assert.deepEqual(errors, []);
      console.log('PASS phone workspace', width + 'x' + height, 'tool panel', Math.round(m.body.height) + 'px');
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
