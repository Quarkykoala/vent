import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const taskDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(taskDir, '../../../apps/web');
const requireApp = createRequire(path.join(appRoot, 'package.json'));
const ts = requireApp('typescript');
const esbuild = createRequire(requireApp.resolve('vitest/package.json'))('esbuild');
const reactTypes = path.dirname(requireApp.resolve('@types/react/package.json'));
const sourcePath = path.join(taskDir, 'PhoneSignIn.tsx');
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  types: [],
  paths: { react: [path.join(reactTypes, 'index.d.ts')], 'react/jsx-runtime': [path.join(reactTypes, 'jsx-runtime.d.ts')] },
};
const program = ts.createProgram([sourcePath], options);
const diagnostics = ts.getPreEmitDiagnostics(program).map(d => ({
  code: d.code,
  message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
}));
fs.writeFileSync(path.join(taskDir, 'compile-result.json'), JSON.stringify({strict: true, errors: diagnostics}, null, 2));
if (diagnostics.length) { console.log(JSON.stringify(diagnostics)); process.exit(1); }

const componentImport = JSON.stringify(sourcePath.replaceAll('\\', '/'));
const built = await esbuild.build({
  stdin: {
    contents: `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PhoneSignIn from ${componentImport};
function Preview(){
  const [age,setAge]=useState(false);
  const [success,setSuccess]=useState(0);
  return <main><h1>Muse sign-in component test</h1><p>Isolated preview. All API responses are synthetic; no SMS is sent.</p>
    <label><input type="checkbox" checked={age} onChange={e=>setAge(e.target.checked)}/>Test: age confirmed</label>
    <PhoneSignIn ageConfirmed={age} onAuthenticated={token=>{if(token==='synthetic-test-token')setSuccess(n=>n+1);}}/>
    <output aria-label="Authentication successes">{success}</output></main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);`,
    loader: 'tsx',
    resolveDir: appRoot,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  nodePaths: [path.join(appRoot, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
});
const script = built.outputFiles[0].text;
const html = '<!doctype html><html><head><meta charset="utf-8"><title>Muse component preview</title><style>body{font:16px system-ui;background:#f4f6f8;color:#17212b;margin:40px}main{max-width:450px;margin:auto}label,input,button{display:block;margin:12px 0}input{padding:10px;box-sizing:border-box}input[type=checkbox]{display:inline}button{padding:10px 18px;cursor:pointer}button:disabled{cursor:default;opacity:.5}[role=alert]{color:#b91c1c}output{display:block;margin-top:20px}form{padding:20px;border:1px solid #ddd;border-radius:12px;background:white}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const calls = [];
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script); return; }
  if (req.url === '/__state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({calls})); return; }
  if (req.method !== 'POST' || !['/api/auth/otp/send', '/api/auth/otp/verify'].includes(req.url)) { res.writeHead(404); res.end(); return; }
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  calls.push({path:req.url, body});
  fs.writeFileSync(path.join(taskDir, 'synthetic-api-calls.json'), JSON.stringify(calls,null,2));
  res.setHeader('Content-Type', 'application/json');
  if (req.url.endsWith('/send')) { res.end(JSON.stringify({success:true,message:'Synthetic code sent'})); return; }
  if (body.code === '000000') { res.writeHead(502, {'Content-Type':'text/html'}); res.end('<html>provider debug message</html>'); return; }
  if (body.code === '111111') { res.end(JSON.stringify({session:{token:''}})); return; }
  if (body.code !== '123456') { res.writeHead(401); res.end(JSON.stringify({error:'Synthetic provider internal error'})); return; }
  res.end(JSON.stringify({session:{token:'synthetic-test-token'}}));
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({strictTypecheck:'pass',url:`http://127.0.0.1:${server.address().port}`,syntheticOnly:true})));
