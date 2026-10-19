import fs from 'node:fs';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import net from 'node:net';

const root=process.cwd();
const directory=path.join(root,'.local','admin-tests',crypto.randomUUID());
fs.mkdirSync(directory,{recursive:true});
const config=path.join(directory,'wrangler.json');
fs.writeFileSync(config,JSON.stringify({name:'bsit-gradeview-admin-tests',main:path.join(root,'server/worker.js'),compatibility_date:'2026-10-19',assets:{directory:path.join(root,'dist'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*']},d1_databases:[{binding:'DB',database_name:'bsit-gradeview-db',database_id:crypto.randomUUID(),migrations_dir:path.join(root,'migrations')}]},null,2));
const env={...process.env,WRANGLER_LOG_PATH:path.join(root,'.wrangler/logs'),WRANGLER_SEND_METRICS:'false',GRADEVIEW_TEST_CONFIG:config};
const wrangler=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const migration=spawnSync(process.execPath,[wrangler,'d1','migrations','apply','bsit-gradeview-db','--local','--config',config],{encoding:'utf8',env});
if(migration.status!==0)throw new Error(migration.stderr||migration.stdout);
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const server=spawn(process.execPath,[wrangler,'dev','--ip','127.0.0.1','--port',String(port),'--config',config],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';server.stdout.on('data',chunk=>{output+=chunk;});server.stderr.on('data',chunk=>{output+=chunk;});
const base=`http://127.0.0.1:${port}`;
try{
  let ready=false;
  for(let attempt=0;attempt<150;attempt++){
    if(server.exitCode!==null)throw new Error(output);
    try{const response=await fetch(base+'/api/session');if(response.status===401){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw new Error('Isolated test server did not become ready.\n'+output);
  console.log('Running admin tests against an isolated local database; existing school records are untouched.');
  const result=spawnSync(process.execPath,['--test','tests/admin-management.test.mjs'],{env:{...env,GRADEVIEW_TEST_URL:base},stdio:'inherit'});
  process.exitCode=result.status??1;
}finally{
  if(server.pid){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else server.kill('SIGTERM');}
}
