import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

test('100 isolated submission scenarios and 100 competing staff changes', async () => {
  const dir=mkdtempSync(join(tmpdir(),'mesa-reliability-'));
  for(const f of ['setup.js','server.js','public']) cpSync(f,join(dir,f),{recursive:true});
  writeFileSync(join(dir,'clock.mjs'),`const R=Date;globalThis.Date=class extends R{constructor(...a){super(...(a.length?a:['2026-11-09T18:00:00Z']))}static now(){return new R('2026-11-09T18:00:00Z').getTime()}}`);
  assert.equal(spawnSync(process.execPath,['setup.js'],{cwd:dir}).status,0);
  const credentials=readFileSync(join(dir,'data/staff-credentials.txt'),'utf8').trim().split('\n').map(line=>line.split(': '));
  const child=spawn(process.execPath,['--import','./clock.mjs','server.js'],{cwd:dir,env:{...process.env,PORT:'31477'},stdio:'ignore'});
  const request=async(path,data,cookie)=>{const response=await fetch('http://localhost:31477'+path,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}};
  const loseResponse=data=>new Promise((resolve,reject)=>{const req=http.request('http://localhost:31477/api/submit',{method:'POST',headers:{'content-type':'application/json'}},res=>{const status=res.statusCode;res.destroy();resolve(status)});req.on('error',reject);req.end(JSON.stringify(data))});
  const attempt=()=>randomBytes(32).toString('base64url');
  const items=[{id:'M1',name:'Chicken casado',price:4500,quantity:1}];
  try {
    for(let i=0;i<50;i++){try{await fetch('http://localhost:31477/api/menu');break}catch{await delay(100)}}
    const cookies=[];
    for(const [username,password] of credentials){const login=await request('/api/login',{username,password});assert.equal(login.status,200);cookies.push(login.cookie)}
    const orderIds=[];
    for(let i=0;i<100;i++){
      const key=attempt(), selection=i%4===3?[null]:items;
      if(i%4===3){const rejected=await request('/api/submit',{attempt:key,items:selection});assert.equal(rejected.status,409);assert.equal((await request('/api/submit',{attempt:key,items})).status,409);continue}
      const [one,two]=i%4===1?await Promise.all([request('/api/submit',{attempt:key,items}),request('/api/submit',{attempt:key,items})]):i%4===2?(assert.equal(await loseResponse({attempt:key,items}),200),[await request('/api/recover',{attempt:key}),null]):[await request('/api/submit',{attempt:key,items}),null];
      assert.equal(one.status,200);if(two)assert.equal(two.body.order.id,one.body.order.id);
      if(i%4===2){const recovered=await request('/api/recover',{attempt:key});assert.equal(recovered.body.order.id,one.body.order.id)}
      orderIds.push(one.body.order.id);
    }
    assert.equal(new Set(orderIds).size,75);
    for(let i=0;i<25;i++){const result=await request('/api/submit',{attempt:attempt(),items});assert.equal(result.status,200);orderIds.push(result.body.order.id)}
    const all=await request('/api/staff/orders?filter=All',null,cookies[0]);assert.equal(all.body.length,100);assert.deepEqual(all.body.map(o=>o.id),[...orderIds].sort((a,b)=>a-b));
    for(const id of orderIds){const [a,b]=await Promise.all([request('/api/staff/orders/'+id,{revision:0,status:'Preparing'},cookies[0]),request('/api/staff/orders/'+id,{revision:0,status:'Cancelled',reason:'Unavailable'},cookies[1])]);assert.deepEqual([a.status,b.status].sort(),[200,409]);assert.match((a.status===409?a:b).body.error,/Order changed/);const current=await request('/api/staff/orders/'+id,null,cookies[0]);assert.equal(current.body.revision,1);assert.equal(current.body.history.length,1);assert.equal(current.body.status,'Preparing'===a.body.status?'Preparing':'Cancelled')}
    // Exercise each transition from each state, including invalid and blank-reason writes.
    const valid={Received:['Preparing','Cancelled'],Preparing:['Ready','Cancelled'],Ready:['Collected','Cancelled'],Collected:[],Cancelled:[]};
    for(const cancelAt of ['Received','Preparing','Ready',null]){
      const created=await request('/api/submit',{attempt:attempt(),items});const id=created.body.order.id;
      let status='Received',revision=0;
      while(true){
        for(const target of ['Received','Preparing','Ready','Collected','Cancelled'])if(!valid[status].includes(target)){
          const rejected=await request('/api/staff/orders/'+id,{revision,status:target,reason:'Unable to fulfil'},cookies[0]);assert.equal(rejected.status,400,`${status} to ${target}`);
        }
        if(valid[status].includes('Cancelled'))for(const reason of ['', '   '])assert.equal((await request('/api/staff/orders/'+id,{revision,status:'Cancelled',reason},cookies[0])).status,400);
        if(status==='Cancelled'||status==='Collected')break;
        const next=cancelAt===status?'Cancelled':({Received:'Preparing',Preparing:'Ready',Ready:'Collected'})[status];
        const changed=await request('/api/staff/orders/'+id,{revision,status:next,reason:'Unable to fulfil'},cookies[0]);assert.equal(changed.status,200);assert.equal(changed.body.status,next);assert.equal(changed.body.history.length,revision+1);assert.equal(changed.body.history.at(-1).employee,'Luis');status=next;revision++;
      }
    }

  } finally {if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve))}rmSync(dir,{recursive:true,force:true})}
});
