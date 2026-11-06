// Live host lifecycle using disposable Ed25519 keys and no real license/settings writes.
(async()=>{
 const fs=require('fs'),path=require('path'),{generateKeyPairSync,sign,createHash}=require('crypto');
 const installed=path.join(app.vault.adapter.getBasePath(),app.vault.configDir,'plugins','crisp-focus','main.js');
 const original=fs.readFileSync(installed,'utf8'),pair=generateKeyPairSync('ed25519');
 const source=original.replace(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/,pair.publicKey.export({type:'spki',format:'pem'}).toString().trim());
 const module={exports:{}},host=require('obsidian');
 new Function('require','module','exports',source+'\nmodule.exports.fixture={managerFor:focusLicenseManagerFor,entitled:focusEntitled,active:focusActive,Session:FocusSessionController,defaults:DEFAULT_SETTINGS};')(name=>name==='obsidian'?{...host,requestUrl:async()=>({status:200,json:{valid:true}})}:require(name),module,module.exports);
 const Plugin=module.exports,api=Plugin.fixture,plugin=Object.create(Plugin.prototype);
 Object.assign(plugin,{app:{appId:'FOCUS-LIVE-E2E',workspace:{getActiveFile:()=>null,getActiveViewOfType:()=>null}},settings:{...api.defaults},mainWindow:window,saveSettings:async()=>true,emitSessionEvent(){},clearCursorStyles(){},updateTypewriterStyles(){},clearTypewriterStyles(){},audio:{stopAmbient(){},updateAmbient(){}}});
 plugin.session=new api.Session();
 const manager=api.managerFor(plugin,{windowObj:window,onEntitlementLost:()=>plugin.onEntitlementLost()});
 const results=[];async function check(name,fn){try{if(!await fn())throw new Error('assertion failed');results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
 const code=()=>{const p=Buffer.from(JSON.stringify({product:'Crisp Suite',features:['all'],expiresAt:'2999-01-01T00:00:00Z'})).toString('base64url');return p+'.'+sign(null,Buffer.from(p),pair.privateKey).toString('base64url');};
 await check('unactivated mode scenes and both session types stay locked',async()=>{
 plugin.settings.focusModeEnabled=false;await plugin.setFocusModeEnabled(true);
 return !plugin.settings.focusModeEnabled&&!(await plugin.applyScene('silent-writing')).applied&&await plugin.startFocusSession(25)===null&&await plugin.startPomodoro()===null;
 });
 await check('public status and verifier overrides cannot activate',async()=>{
 plugin.licenseVerifier=async()=>({valid:true});manager.runVerifier=async()=>({valid:true,payload:{}});manager.isEntitled=()=>true;
 Object.defineProperty(manager,'status',{configurable:true,get:()=>({valid:true}),set(r){r.valid=true;r.payload={};}});
 await manager.verify('invalid');return !api.entitled(plugin);
 });
 await check('real signature enables a running focus session',async()=>{
 await manager.verify(code());const session=await plugin.startFocusSession(25);return api.active(plugin)&&session.status==='running';
 });
 await check('rejected verification pauses running session and blocks resume',async()=>{
 await manager.verify('invalid');return !api.entitled(plugin)&&plugin.session.getSnapshot().status==='paused'&&await plugin.resumeFocusSession()===null;
 });
 manager.destroy();plugin.session.destroy();
 return JSON.stringify({host:'Live Obsidian Electron',artifactSha256:createHash('sha256').update(original).digest('hex'),results,passed:results.every(r=>r.passed)});
})()
