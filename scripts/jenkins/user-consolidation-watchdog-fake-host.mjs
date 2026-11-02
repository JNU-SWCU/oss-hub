export const fakeCommand = String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const a=process.argv.slice(2),command=path.basename(process.argv[1]),root=process.env.FIXTURE;
const file=path.join(root,'world.json'),s=JSON.parse(fs.readFileSync(file)),run=s.activeRun||path.join(root,'run');
const save=()=>fs.writeFileSync(file,JSON.stringify(s)),out=v=>process.stdout.write(String(v));
const opened=()=>fs.existsSync(path.join(run,'OPEN_COMMITTED'));
const event=name=>fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify({name,schema:s.schema,ingress:s.ingress,backend:s.backend,open:opened(),writes:s.writes})+'\n');
const fail=()=>process.exit(42);
const named=id=>s.containers.find(n=>crypto.createHash('sha256').update(n).digest('hex')===id)||id;
const describe=name=>({
  Id:name==='backend'||name==='postgres'?name:crypto.createHash('sha256').update(name).digest('hex'),
  Name:'/'+name,Image:s.containerImages?.[name]||'sha256:'+(name==='backend'&&s.backend!=='new'?'1':'2').repeat(64),
  Config:{Env:['DATABASE_URL=postgresql://u:p@postgres/app','POSTGRES_USER=u','POSTGRES_DB=app','POSTGRES_PASSWORD=p'],
    Labels:{'com.docker.compose.project':'oss-hub','com.docker.compose.service':name==='postgres'?'postgres':'backend',
      'com.docker.compose.oneoff':name==='backend'||name==='postgres'?'False':'True',
      'oss-hub.user-consolidation.run':s.owners?.[name]||''}},
  State:{Running:name==='backend'?s.backend!==null:!s.stopped?.includes(name)},
  NetworkSettings:{Networks:{default:{IPAddress:'172.20.0.9'}}}
});
if(command==='systemd-id128'){out(process.env.BOOT_ID||'boot-one');}
else if(command==='systemd-notify'){out('WATCHDOG_READY\n');}
else if(command==='systemctl'){
  const pidfile=path.join(root,'driver.pid');
  if(a[0]==='is-active'){
    if(!fs.existsSync(pidfile))process.exit(3);
    try{process.kill(Number(fs.readFileSync(pidfile)),0);}catch(e){if(!(e instanceof Error)||e.code!=='ESRCH')throw e;process.exit(3);}
  }else if(a[0]==='kill'||a[0]==='stop'&&a[1].includes('consolidation-driver')){
    if(fs.existsSync(pidfile)){try{process.kill(-Number(fs.readFileSync(pidfile)),'SIGKILL');}catch(e){if(!(e instanceof Error)||e.code!=='ESRCH')throw e;}fs.unlinkSync(pidfile);}
  }else if(a[0]==='reload'){s.ingress=fs.readFileSync(process.env.UC_HOST_NGINX,'utf8').includes('return 503;')?'closed':'open';event('ingress-'+s.ingress);save();}
  else if(['start','stop'].includes(a[0])){s.externalWriters=a[0]==='start';save();}
  else fail();
}else if(command==='nginx'){process.exit(0);}
else if(command==='curl'){
  if(s.failure==='fence-curl-transient'&&s.ingress==='closed'){
    s.fenceProbeAttempts=(s.fenceProbeAttempts||0)+1;save();
    if(s.fenceProbeAttempts===1){
      event('fence-probe-error:55');out('000');
      process.stderr.write('curl: (55) Failed sending HTTP request\n');process.exit(55);
    }
    event('fence-probe:503');
  }
  out(s.ingress==='closed'?'503':'200');
}
else if(command==='docker'){
  if(a[0]==='image'){
    const old=a.at(-1).includes('v1.0.0');
    out(a.join(' ').includes('revision')?'b'.repeat(40):'sha256:'+(old?'1':'2').repeat(64));
  }else if(a[0]==='ps'){
    const filters=a.filter((x,i)=>a[i-1]==='--filter');
    const matches=['backend',...s.containers].map(describe).filter(c=>
      (a[1].includes('a')||c.State.Running)&&filters.every(f=>{
        if(f.startsWith('name='))return new RegExp(f.slice(5)).test(c.Name);
        if(f.startsWith('label=')){const i=f.indexOf('=',6);return i<0?f.slice(6) in c.Config.Labels:c.Config.Labels[f.slice(6,i)]===f.slice(i+1);}
        fail();
      }));
    out(matches.map(c=>c.Id).join('\n'));
  }else if(a[0]==='inspect'){
    out(JSON.stringify(a.slice(1).map(id=>describe(named(id)))));
  }else if(a[0]==='update'){s.restart=false;save();}
  else if(a[0]==='stop'){
    const name=named(a.at(-1));if(name==='backend'){s.backend=null;event('backend-stopped');}
    else {s.stopped??=[];s.stopped.push(name);event('container-stopped:'+name);}save();
  }
  else if(a[0]==='rm'){const name=named(a.at(-1));s.containers=s.containers.filter(x=>x!==name);save();}
  else if(a[0]==='compose'){
    const op=a.find(x=>['run','up','pull','exec'].includes(x));
    const target=a[a.indexOf('--env-file')+1].includes('previous')?'old':'new';
    if(op==='pull')process.exit(0);
    if(op==='up'){
      if(!opened()||s.schema!==target||(target==='new'&&s.dbPhase!=='OPEN_COMMITTED'))fail();
      s.backend=target;s.writes.push(target+'-scheduled-write');event('writer-started');save();
    }else if(op==='exec'){
      if(a.includes('curl')&&s.failure==='open-health'&&s.backend==='new')fail();
      if(!a.includes('-d')&&!a.includes('--interactive=false'))process.stdin.resume();
    }else if(op==='run'){
      const name=a[a.indexOf('--name')+1];
      s.stopped=(s.stopped||[]).filter(n=>n!==name);
      if(a.includes('sha256sum'))out(crypto.createHash('sha256').update(s.imageSql).digest('hex')+'  migration.sql');
      else if(a.includes('verify-maintenance-capability')){if(s.failure==='capability'||!a.includes('dist/src/cli.js'))fail();}
      else if(name==='oss-hub-uc-migrate'){
        s.containers.push(name);s.owners??={};s.owners[name]=a.find(x=>x.startsWith('oss-hub.user-consolidation.run='))?.split('=').slice(1).join('=')||'';save();out(describe(name).Id);
      }
      else if(name==='oss-hub-uc-candidate'){
        if(!a.includes('OSS_HUB_MAINTENANCE=1')||!a.includes('PORT=4000')||!a.includes('dist/src/main.js')||!a.some(x=>x.startsWith('DATABASE_URL=')&&x.endsWith('/oss_hub_uc_verification')))fail();
        s.containers.push(name);s.owners??={};s.owners[name]=a.find(x=>x.startsWith('oss-hub.user-consolidation.run='))?.split('=').slice(1).join('=')||'';
        s.candidateIsolated=true;s.candidateReady=false;save();out(describe(name).Id);
      }
      // Foreground Compose run attaches stdin by default, even after producing output.
      process.once('exit',code=>{if(code===0)event('oneoff-completed:'+name);});
      if(!a.includes('-d')&&!a.includes('--interactive=false'))process.stdin.resume();
    }else fail();
  }else if(a[0]==='exec'){
    const script=a.find(x=>x.includes('psql')||x.includes('pg_')||x.includes('pg_dump')||x.includes('pg_restore')||x.includes('createdb')||x.includes('dropdb'));
    if(a.includes('curl')&&named(a[1])==='oss-hub-uc-candidate'){
      if(a[1]!==describe('oss-hub-uc-candidate').Id)fail();
      if(s.failure==='failed-start'){event('candidate-start-failed');fail();}
      const ready=()=>{s.candidateReady=true;event('candidate-ready');save();};
      if(s.failure==='delayed-start'){
        const server=net.createServer(socket=>{socket.once('data',()=>{ready();socket.end();server.close();});});
        server.listen(path.join(root,'readiness.sock'),()=>process.stderr.write('READINESS_WAIT\n'));
      }else ready();
    }else if(a.includes('deploy')){
      if(s.ingress!=='closed'||s.backend!==null||!s.blocked||!s.backupRestored)fail();
      if(s.ledger.some(r=>r.finished_at===null&&r.rolled_back_at===null))fail();
      const row={migration_name:'20261102160000_consolidate_user_domain',checksum:crypto.createHash('sha256').update(s.imageSql).digest('hex'),finished_at:null,rolled_back_at:null,startedEpoch:Date.now()/1000};
      s.ledger.push(row);
      if(['transaction','resolve-response-lost'].includes(s.failure)){event('transaction-failed');save();fail();}
      row.finished_at='finished';s.schema='new';s.dbPhase='FENCED';event('schema-migrated');save();
      if(s.failure==='migrate')fail();
      if(s.failure==='hang'){
        const server=net.createServer();server.listen(path.join(root,'hung.sock'),()=>out('MIGRATION_HUNG\n'));
      }
    }else if(a.includes('resolve')){
      if(opened()||s.schema!=='old'||s.dbPhase&&s.dbPhase!=='ROLLED_BACK'||!s.blocked||a[a.indexOf('--rolled-back')+1]!=='20261102160000_consolidate_user_domain')fail();
      const rows=s.ledger.filter(r=>r.migration_name===a[a.indexOf('--rolled-back')+1]&&r.finished_at===null&&r.rolled_back_at===null);
      if(rows.length!==1||s.failure==='resolve')fail();
      rows[0].rolled_back_at='resolved';event('attempt-resolved');save();
      if(s.failure==='resolve-response-lost')fail();
    }else if(a.includes('verify-maintenance-state')){
      if(a[1]!==describe('oss-hub-uc-candidate').Id||!a.includes('dist/src/cli.js')||!s.candidateReady||!s.candidateIsolated||s.clone!=='new'||['verify','rollback'].includes(s.failure))fail();
      event('candidate-verified');
    }else if(script?.includes('pg_hba')){
      if(script.startsWith('test !')){if(s.hbaSaved)fail();}
      else if(script.includes('rm "$PGDATA')){s.hbaSaved=false;save();}
      else if(script.startsWith('cp "$PGDATA')){s.blocked=false;event('database-opened');save();}
      else {s.hbaSaved=true;s.blocked=true;save();}
    }else if(script?.includes('pg_dump')){out(JSON.stringify({schema:s.schema}));event('backup');}
    else if(script?.includes('pg_restore')){
      s.clone=JSON.parse(fs.readFileSync(0,'utf8')).schema;s.backupRestored=true;save();
    }else if(script?.includes('createdb')){s.clone=script.includes('-T "$POSTGRES_DB"')?s.schema:'empty';save();}
    else if(script?.includes('dropdb')){s.clone=null;save();}
    else if(script?.includes('psql')){
      const query=a.at(-1);
      if(query.includes('pg_database'))out(s.clone===null?'0':'1');
      else if(query.includes('pg_terminate_backend'))out('t');
      else if(query.includes('pg_stat_activity'))out(s.failure==='unknown-writer'?'1':'0');
      else if(query.includes('to_regclass'))out(query.includes('backup.control')?(s.dbPhase?'f':'t'):(s.schema==='old'?'t':'f'));
      else if(query.includes('SELECT phase FROM'))out(s.dbPhase);
      else if(query.includes('json_agg'))out(JSON.stringify(s.ledger));
      else if(query.includes('SELECT migration_name')||script.includes('SELECT migration_name'))out(s.schema==='old'||script.includes('-d "$1"')?'20261031000000_previous':'20261102160000_consolidate_user_domain');
      else{
        const sql=fs.readFileSync(0,'utf8');
        if(sql.includes('ROLLBACK_ARTIFACT')){
          if(opened()||s.writes.length||s.dbPhase==='OPEN_COMMITTED'||s.failure==='rollback'||!a.some(x=>x.includes('oss_hub.user_consolidation_rollback=FENCED')))fail();
          if(s.schema==='new'){s.schema='old';s.dbPhase='ROLLED_BACK';s.ledger=[];event('schema-rolled-back');save();}
        }else if(sql.includes('OPEN_ARTIFACT')){
          if(!opened()||s.schema!=='new'||s.failure==='database-open')fail();
          s.dbPhase='OPEN_COMMITTED';event('database-open-committed');save();
        }else if(sql.includes('PREFLIGHT_ARTIFACT')&&s.schema!=='old')fail();
        else if(sql.includes('RECONCILE_ARTIFACT')&&s.schema!=='new')fail();
      }
    }else fail();
  }else fail();
}else if(command==='sync'){process.exit(0);}
else fail();
`;
