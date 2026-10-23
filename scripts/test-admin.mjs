import fs from 'node:fs';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import net from 'node:net';

const root=process.cwd();
const free=process.argv.includes('--free');
const databaseSecret=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const directory=path.join(root,'.local','admin-tests',crypto.randomUUID());
fs.mkdirSync(directory,{recursive:true});
const config=path.join(directory,'wrangler.json');
fs.writeFileSync(config,JSON.stringify({name:'bsit-gradeview-admin-tests',main:path.join(root,'server/worker.js'),compatibility_date:'2026-10-19',assets:{directory:path.join(root,'dist'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*']},d1_databases:[{binding:'DB',database_name:'bsit-gradeview-db',database_id:crypto.randomUUID(),migrations_dir:path.join(root,'migrations')}]},null,2));
if(free){
  const gatewayConfig=JSON.parse(fs.readFileSync(config,'utf8'));
  gatewayConfig.main=path.join(root,'server/database-worker.js');
  gatewayConfig.vars={DATABASE_SECRET:databaseSecret};
  delete gatewayConfig.assets;
  fs.writeFileSync(config,JSON.stringify(gatewayConfig,null,2));
}
const env={...process.env,WRANGLER_LOG_PATH:path.join(root,'.wrangler/logs'),WRANGLER_SEND_METRICS:'false',GRADEVIEW_TEST_CONFIG:config};
const wrangler=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const migration=spawnSync(process.execPath,[wrangler,'d1','migrations','apply','bsit-gradeview-db','--local','--config',config],{encoding:'utf8',env});
if(migration.status!==0)throw new Error(migration.stderr||migration.stdout);
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const server=spawn(process.execPath,[wrangler,'dev','--ip','127.0.0.1','--port',String(port),'--config',config],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';server.stdout.on('data',chunk=>{output+=chunk;});server.stderr.on('data',chunk=>{output+=chunk;});
const base=`http://127.0.0.1:${port}`;
let apiServer;
try{
  let ready=false;
  for(let attempt=0;attempt<150;attempt++){
    if(server.exitCode!==null)throw new Error(output);
    try{const response=await fetch(base+(free?'/api/health':'/api/session'));if(response.status===(free?200:401)){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw new Error('Isolated test server did not become ready.\n'+output);
  let testBase=base;
  if(free){
    apiServer=spawn(process.execPath,['scripts/serve-vercel-test.mjs'],{env:{...env,NODE_ENV:'test',GRADEVIEW_DATABASE_URL:base,GRADEVIEW_DATABASE_SECRET:databaseSecret},stdio:['ignore','pipe','pipe'],windowsHide:true});
    let apiOutput='';
    apiServer.stdout.on('data',chunk=>{apiOutput+=chunk;});
    apiServer.stderr.on('data',chunk=>{apiOutput+=chunk;});
    let apiReady=false;
    for(let attempt=0;attempt<100;attempt++){
      if(apiServer.exitCode!==null)throw new Error(apiOutput);
      const match=apiOutput.match(/TEST_API=(http:\/\/127\.0\.0\.1:\d+)/);
      if(match){testBase=match[1];apiReady=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!apiReady)throw new Error('Vercel test API did not become ready.\n'+apiOutput);
    console.log('Testing the Vercel API through the protected Cloudflare database gateway.');
  }
  console.log('Running tests against an isolated local database; existing school records are untouched.');
  const files = process.argv.includes('--all') ? ['tests/database.test.mjs','tests/onboarding.test.mjs','tests/admin-management.test.mjs','tests/admin-tools.test.mjs','tests/transfer-students.test.mjs','tests/retakes.test.mjs','tests/production.test.mjs','tests/pdf-export.test.mjs'] : ['tests/admin-management.test.mjs','tests/admin-tools.test.mjs','tests/transfer-students.test.mjs','tests/retakes.test.mjs'];
  if(free)files.push('tests/gateway-integration.test.mjs');
  if(process.argv.includes('--all'))files.push('tests/quickenroll.test.mjs');
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{env:{...env,GRADEVIEW_TEST_URL:testBase,...(free?{GRADEVIEW_GATEWAY_URL:base,GRADEVIEW_DATABASE_SECRET:databaseSecret}:{})},stdio:'inherit'});
  process.exitCode=result.status??1;
}finally{
  if(apiServer?.pid){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(apiServer.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else apiServer.kill('SIGTERM');}
  if(server.pid){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else server.kill('SIGTERM');}
}
