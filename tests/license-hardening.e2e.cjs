// Isolated lifecycle E2E: real Ed25519, disposable keys, no credentials or network.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { generateKeyPairSync, sign, webcrypto, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const id = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).id;
const prefix = id === 'crisp-focus' ? 'focus' : 'visual';
const pair = generateKeyPairSync('ed25519');
const pem = pair.publicKey.export({type:'spki',format:'pem'}).toString().trim();
const original = fs.readFileSync(process.env.LICENSE_SOURCE || path.join(root,'main.js'),'utf8');
const code = (expiry='2999-01-01T00:00:00Z') => {
 const payload=Buffer.from(JSON.stringify({product:'Crisp Suite',features:['all'],expiresAt:expiry})).toString('base64url');
 return payload+'.'+sign(null,Buffer.from(payload),pair.privateKey).toString('base64url');
};
function fixture() {
 const timers=new Set(); const module={exports:{}};
 const sandbox={module,exports:module.exports,Buffer,TextEncoder,TextDecoder,atob,btoa,crypto:webcrypto,console,
 setTimeout(fn,ms){ const t=setTimeout(fn,ms); timers.add(t); return t; },clearTimeout,
 require(name){if(name!=='obsidian')return require(name);return new Proxy({requestUrl:async()=>({status:200,json:{valid:true}}),addIcon(){},debounce(fn){return fn;}},{get:(o,k)=>o[k]||class{}});}};
 sandbox.window=sandbox;
 const source=original.replace(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/,pem);
 vm.runInNewContext(source+`\nmodule.exports.__e2e={managerFor:${prefix}LicenseManagerFor,entitled:${prefix}Entitled,Session:FocusSessionController};`,sandbox);
 const plugin={app:{appId:'E2E',workspace:{getLeavesOfType:()=>[]}},settings:{licenseCode:''},saveSettings:async()=>{}};
 const api=module.exports.__e2e, manager=api.managerFor(plugin);
 return {Plugin:module.exports,plugin,manager,api,close(){manager.destroy?.();for(const t of timers)clearTimeout(t);}};
}
(async()=>{
 const results=[];
 async function check(name,fn){const f=fixture();try{await fn(f);results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message.split('\n')[0]});}finally{f.close();}}
 await check('display status setter cannot turn rejected verification into activation',async f=>{
 Object.defineProperty(f.manager,'status',{configurable:true,get:()=>({valid:true}),set(result){result.valid=true;result.payload={};}});
 await f.manager.verify('invalid');assert.equal(f.api.entitled(f.plugin),false);
 });
 await check('public verifier and status replacements cannot activate',async f=>{
 f.plugin.licenseVerifier=async()=>({valid:true,payload:{}});
 f.manager.runVerifier=async()=>({valid:true,payload:{}});
 f.manager.status={valid:true,payload:{}};f.manager.isEntitled=()=>true;
 await f.manager.verify('invalid');assert.equal(f.api.entitled(f.plugin),false);
 });
 await check('signed activation then rejection revokes private entitlement',async f=>{
 await f.manager.verify(code());assert.equal(f.api.entitled(f.plugin),true);
 await f.manager.verify('invalid');assert.equal(f.api.entitled(f.plugin),false);
 });
 await check('expired signature stays locked',async f=>{
 await f.manager.verify(code('2000-01-01T00:00:00Z'));assert.equal(f.api.entitled(f.plugin),false);
 });
 await check('revocation pauses a real running session and blocks resume',async f=>{
 Object.setPrototypeOf(f.plugin, f.Plugin.prototype);
 Object.assign(f.plugin,{saveSettings:async()=>{},clearCursorStyles(){},updateTypewriterStyles(){},renderSessionStatus(){},emitSessionEvent(){},elapsedMs(){return 0;},audio:{stopAmbient(){}}});
 f.plugin.session=new f.api.Session({setInterval:()=>0,clearInterval(){}});
 f.manager.onEntitlementLost=()=>f.plugin.onEntitlementLost();
 await f.manager.verify(code());f.plugin.session.start(25);
 await f.manager.verify('invalid');
 assert.equal(f.plugin.session.getSnapshot().status,'paused');
 assert.equal(await f.plugin.resumeFocusSession(),null);
 assert.equal(f.plugin.session.getSnapshot().status,'paused');
 f.plugin.session.destroy();
 });
 const report={plugin:id,artifactSha256:createHash('sha256').update(original).digest('hex'),results,passed:results.every(r=>r.passed)};
 const output=process.env.LICENSE_REPORT||path.join(require('node:os').tmpdir(),id+'-license-hardening.json');
 fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({report:output,...report},null,2));process.exitCode=report.passed?0:1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
