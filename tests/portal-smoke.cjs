// Run with Node 22+: node tests/portal-smoke.cjs
// CHROME_PATH can point to a Chrome/Chromium executable on other systems.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp');
fs.mkdirSync(output, { recursive: true });
const logFile = path.join(output, 'portal-smoke.log');
fs.writeFileSync(logFile, 'Starting portal browser checks\n');
const originalLog = console.log;
console.log = (...args) => { fs.appendFileSync(logFile, args.join(' ') + '\n'); originalLog(...args); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
let chrome, socket, pythonServer, testBase;
const testToken=crypto.randomUUID();
const runtimeErrors = [];
async function run() {
  pythonServer=spawn(path.join(root,'.venv','Scripts','python.exe'),['tests/browser_server.py'],{cwd:root,env:{...process.env,BROWSER_TEST_TOKEN:testToken},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{
    let output='',errors='';const timeout=setTimeout(()=>reject(new Error('Python test server timed out: '+errors)),30000);
    pythonServer.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/READY (\d+)/);if(match){clearTimeout(timeout);resolve('http://127.0.0.1:'+match[1]);}});
    pythonServer.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4000);});
    pythonServer.on('error',reject);pythonServer.on('exit',code=>{if(!output.includes('READY')){clearTimeout(timeout);reject(new Error('Python server exited '+code+': '+errors));}});
  });
  testBase=base;
  const executable = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const profile = path.join(output, 'browser-' + Date.now());
  chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let spawnError;
  chrome.on('error', err => { spawnError = err; });
  let port;
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await delay(100); }
  }
  if (!port) throw new Error('Headless Chrome did not start.');
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const pair = pending.get(message.id);
      if (!pair) return;
      pending.delete(message.id);
      message.error ? pair.reject(new Error(message.error.message)) : pair.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  };
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 12000);
      pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: err => { clearTimeout(timeout); reject(err); } });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async function tab() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Evaluation failed');
      return result.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await delay(30); }
      throw new Error('Timed out: ' + expression);
    };
    return {
      evaluate, wait,
      navigate: async url => { await send('Page.navigate', { url }, sessionId); await wait(`location.href === ${JSON.stringify(url)} && document.readyState === "complete"`); },
      click: async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); },
      fill: async (selector, value) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}`); },
      activate: async () => send('Page.bringToFront',{},sessionId),
      fileInput: async (selector,file) => { const doc=await send('DOM.getDocument',{},sessionId); const {nodeId}=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector},sessionId); await send('DOM.setFileInputFiles',{nodeId,files:[file]},sessionId); },
      viewport: async (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId),
      blockExternalCharts: async () => { await send('Network.enable', {}, sessionId); await send('Network.setBlockedURLs', { urls: ['*cdn.jsdelivr.net*'] }, sessionId); },
      screenshot: async name => { await send('Page.bringToFront', {}, sessionId); await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }, sessionId); const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId); fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64')); }
    };
  }
  await require('./database-scenarios.cjs')({ tab, base, delay, runtimeErrors });
}
run().catch(err => { fs.appendFileSync(logFile, 'FAIL ' + err.stack + '\n'); console.error(err); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (chrome) chrome.kill();
  if(testBase) await fetch(testBase+'/__test_shutdown',{method:'POST',headers:{'X-Test-Token':testToken}}).catch(()=>{});
  server.closeAllConnections();
  server.close();
});
