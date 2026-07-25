import assert from 'node:assert/strict';
import { startRelay, stopRelay, roomCount } from './server.js';

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok - ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL - ${label}`);
    console.error(err.stack);
    process.exitCode = 1;
  }
}

console.log('relay/server.test.js');

let base;

await check('the relay starts and reports health', async () => {
  const { port } = await startRelay({ port: 0 });
  base = `http://127.0.0.1:${port}`;
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.ok, true);
  assert.equal(roomCount(), 0);
});

await check('serves the player page for any /r/<code> path', async () => {
  const root = await fetch(`${base}/`);
  assert.equal(root.status, 200);
  const page = await fetch(`${base}/r/ABCD`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /seat\.js/);
});

await check('serves the browser-safe modules the seat page imports', async () => {
  for (const p of ['/js/seat.js', '/js/mapSurface.js', '/js/mapCamera.js', '/js/grid.js', '/styles/main.css']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, `${p} should be served`);
  }
});

await check('does not serve anything off the whitelist', async () => {
  assert.equal((await fetch(`${base}/js/app.js`)).status, 404);
  assert.equal((await fetch(`${base}/assets/fonts/..%2f..%2fpackage.json`)).status, 404);
});

await stopRelay();
console.log(`\n${passed} passed`);
