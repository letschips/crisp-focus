// Disposable host plugin supplies Obsidian's real plugin require, absent from CLI eval.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawnSync}=require('node:child_process');
const live=fs.readFileSync(path.join(__dirname,'license-gates.live.js'),'utf8');
const fixtureScript='const {Plugin}=require("obsidian");module.exports=class extends Plugin{async onload(){this.run=()=>new Function("require","app",'+JSON.stringify('return (\n'+live+'\n)')+')(require,this.app)}}';
new Function('require','module','exports',fixtureScript);
const host=`(async()=>{
 const fs=require('fs'),path=require('path');
 const id='crisp-license-e2e-'+Date.now();
 const dir=app.vault.configDir+'/plugins/'+id;
 const abs=path.join(app.vault.adapter.getBasePath(),dir);
 fs.mkdirSync(abs,{recursive:true});
 const manifest={id,name:'Disposable License E2E',version:'0.0.0',minAppVersion:'1.6.0',dir};
 fs.writeFileSync(path.join(abs,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(abs,'main.js'),${JSON.stringify(fixtureScript)});
 app.plugins.manifests[id]=manifest;
 try{const p=await app.plugins.loadPlugin(id);return await p.run();}
 finally{await app.plugins.unloadPlugin(id);delete app.plugins.manifests[id];fs.rmSync(abs,{recursive:true,force:true});}
})().catch(e=>JSON.stringify({passed:false,error:e.stack}))`;
const args=[];if(process.env.FOCUS_VAULT)args.push('vault='+process.env.FOCUS_VAULT);
args.push('eval','code='+host);
const result=spawnSync('obsidian',args,{encoding:'utf8',timeout:30000});
if(result.error||result.status!==0||!result.stdout.includes('=> '))throw result.error||new Error(result.stderr||result.stdout||'Obsidian evaluation failed');
const report=JSON.parse(result.stdout.split('=> ',2)[1].trim());
const output=process.env.FOCUS_REPORT||path.join(os.tmpdir(),'focus-license-gates-'+Date.now()+'.json');
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({report:output,...report},null,2));process.exitCode=report.passed?0:1;
