// Drives a real, visible Chrome window over the DevTools protocol to demo the app.
// Usage: node demo/drive.js  (expects Chrome started with --remote-debugging-port=9222, app on :3000)
// Logs "T+ss.s  segment" lines so the video can be verified frame-by-frame.

const APP = process.env.APP_URL || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_KEY;
const CDP = 'http://127.0.0.1:9222';
const t0 = Date.now();
const log = (m) => console.log(`T+${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}  ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; 
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { const p = this.pending.get(m.id); p && (this.pending.delete(m.id), m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)); } else this.events.push(m); }; }
  static async connect(wsUrl) { const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); const p = new Page(ws); await p.send('Page.enable'); await p.send('Runtime.enable'); return p; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description)); return r.result.value; }
  async goto(url) { this.events = []; await this.send('Page.navigate', { url }); await this.waitLoad(); }
  async waitLoad() { for (let i = 0; i < 100; i++) { if (this.events.some((e) => e.method === 'Page.loadEventFired')) { this.events = []; return; } await sleep(50); } }
  async type(selector, text, delay = 55) {
    await this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.value='';return true})()`);
    for (const ch of text) { await this.send('Input.insertText', { text: ch }); await sleep(delay + Math.random() * 40); }
  }
  async click(selector) {
    const q = await this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!q) throw new Error('no element ' + selector);
    // move the *page* pointer (not the OS cursor) then click, so :hover styles show
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y });
    await sleep(250);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', clickCount: 1 });
    await sleep(70);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', clickCount: 1 });
  }
  async submit(selector) { this.events = []; await this.click(selector); await this.waitLoad(); }
  async scrollTo(y) { await this.eval(`window.scrollTo({top:${y},behavior:'smooth'});true`); }
  url() { return this.eval('location.href'); }
}

const json = async (u, opts) => (await fetch(u, opts)).json();

async function main() {
  const targets = await json(`${CDP}/json`);
  const first = targets.find((t) => t.type === 'page');
  const page = await Page.connect(first.webSocketDebuggerUrl);
  const { windowId } = await page.send('Browser.getWindowForTarget');
  await page.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1280, height: 860, windowState: 'normal' } });

  await page.goto(`${APP}/`);
  log('S0 home');
  await sleep(2500);

  // --- Segment 1: name only -> asked for 2nd factor
  log('S1 typing name only');
  await page.type('#name', 'Priya Sharma');
  await sleep(600);
  await page.submit('button[type=submit]');
  log('S1 need_handle shown');
  await sleep(3200);

  // --- Segment 5a: wrong email
  log('S5a wrong email');
  await page.type('#handle', 'someone.else@example.com', 45);
  await sleep(500);
  await page.submit('button[type=submit]');
  log('S5a mismatch shown');
  await sleep(3000);

  // --- Segment 2: correct email -> access page
  log('S2 correct email');
  await page.type('#handle', 'priya.sharma@example.com', 45);
  await sleep(500);
  await page.submit('button[type=submit]');
  const accessUrl = await page.url();
  log('S2 access page (Wi-Fi QR) ' + accessUrl.slice(0, 60) + '…');
  await sleep(3500);
  await page.scrollTo(400);
  await sleep(2200);

  // --- Segment 3: claim -> redirect to (dummy) sponsor page
  log('S3 click Get my credits');
  await page.submit('form[action^="/go/"] button');
  log('S3 redirected to sponsor page');
  await sleep(3200);

  // back, click again -> already claimed
  await page.goto(accessUrl);
  await page.scrollTo(400);
  await sleep(1800);
  log('S3 second click');
  await page.submit('form[action^="/go/"] button');
  log('S3 already_claimed shown');
  await sleep(3200);

  // --- Segment 4: forwarded link in a fresh (incognito) context -> 403
  log('S4 open link in fresh incognito context');
  const ver = await json(`${CDP}/json/version`);
  const browser = await Page.connect(ver.webSocketDebuggerUrl).catch(async () => { const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); return new Page(ws); });
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId, newWindow: true, width: 1280, height: 860 });
  const t2 = (await json(`${CDP}/json`)).find((t) => t.id === targetId);
  const inc = await Page.connect(t2.webSocketDebuggerUrl);
  const w2 = await inc.send('Browser.getWindowForTarget');
  await inc.send('Browser.setWindowBounds', { windowId: w2.windowId, bounds: { left: 0, top: 0, width: 1280, height: 860, windowState: 'normal' } });
  await sleep(800);
  await inc.goto(accessUrl);
  log('S4 403 device-bound shown');
  await sleep(3500);
  await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  await browser.send('Target.activateTarget', { targetId: first.id });
  await sleep(600);

  // --- Segment 5b: not on the approved list
  await page.goto(`${APP}/`);
  log('S5b pending guest attempt');
  await page.type('#name', 'Rohan Gupta');
  await page.type('#handle', 'rohan.g@example.com', 40);
  await sleep(400);
  await page.submit('button[type=submit]');
  log('S5b not_found shown');
  await sleep(3200);

  // --- Segment 6: admin
  await page.goto(`${APP}/admin?key=${ADMIN_KEY}`);
  log('S6 admin dashboard');
  await sleep(3000);
  await page.scrollTo(520);
  log('S6 claims table');
  await sleep(2500);
  // reset Priya's claim (confirm() auto-accepted via override)
  await page.eval('window.confirm=()=>true;true');
  await page.submit('form[action^="/admin/reset"] button');
  log('S6 claim reset');
  await sleep(2500);
  await page.scrollTo(900);
  log('S6 roster');
  await sleep(3000);

  // CSV import (file set via DevTools so no OS dialog)
  await page.scrollTo(0);
  await sleep(800);
  const { root } = await page.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await page.send('DOM.setFileInputFiles', { nodeId, files: [process.env.CSV_PATH] });
  log('S6 CSV selected');
  await sleep(1500);
  await page.submit('form[action^="/admin/import"] button');
  log('S6 CSV imported');
  await sleep(3500);
  log('DONE');
}

main().then(() => process.exit(0)).catch((e) => { console.error('driver error:', e.message); process.exit(1); });
