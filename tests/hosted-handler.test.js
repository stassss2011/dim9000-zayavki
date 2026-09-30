import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../base44/functions/dimApi/handler.js';
import { decrypt } from '../base44/functions/dimApi/crypto.js';

const owner={id:'owner-id',email:'owner@example.test'};
function setup(){
 const records=new Map();let next=0;
 const repo={get:async id=>records.get(id),create:async data=>{const row={...data,id:String(++next).padStart(24,'0')};records.set(row.id,row);return row;},update:async(id,data)=>{Object.assign(records.get(id),data);},delete:async id=>{records.delete(id);}};
 const deps={authenticate:async()=>owner,repoFactory:()=>repo,getSecret:key=>({OWNER_EMAIL:owner.email,SESSION_ENCRYPTION_KEY:'11'.repeat(32),DIM9000_CLIENT_ID:'test',DIM9000_CLIENT_SECRET:'test'}[key]),clientFactory:opts=>({tokens:opts.tokens,login:async()=>opts.save({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()+10000}),requestSms:async()=>{}})};
 const request=async(body,overrides={})=>handle(new Request('https://example.test/functions/dimApi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{...deps,...overrides});
 return {records,deps,request};
}
test('unauthenticated and non-owner callers never get service-role data access',async()=>{
 const {request}=setup();let accessed=false;
 for(const authenticate of [async()=>null,async()=>({id:'other',email:'other@example.test'})]){
  const r=await request({op:'status'},{authenticate,repoFactory:()=>{accessed=true;throw Error('must not access');}});
  assert.ok([401,403].includes(r.status));
 }
 assert.equal(accessed,false);
});
test('browser sessions are separate and stored tokens are encrypted',async()=>{
 const {request,records}=setup();
 const a=await (await request({op:'login',body:{phone:'+10000000000',code:'000000'}})).json();
 const b=await (await request({op:'login',body:{phone:'+10000000000',code:'000000'}})).json();
 assert.notEqual(a.sessionId,b.sessionId);
 assert.ok(!JSON.stringify(a).includes('synthetic'));
 const row=records.get(a.sessionId);assert.ok(!row.encrypted_tokens.includes('synthetic'));
 const tokens=await decrypt(row.encrypted_tokens,'11'.repeat(32),owner.id+':'+row.id);
 assert.equal(tokens.access_token,'synthetic-access');
 await request({op:'logout',sessionId:a.sessionId});
 assert.equal(records.has(a.sessionId),false);assert.equal(records.has(b.sessionId),true);
});
test('session IDs belonging to another owner or expired sessions cannot be used',async()=>{
 const {request,records}=setup();
 const {sessionId}=await (await request({op:'login',body:{phone:'+10000000000',code:'000000'}})).json();
 records.get(sessionId).owner_id='someone-else';
 assert.equal((await request({op:'call',sessionId,body:{action:'bootstrap'}})).status,401);
 records.get(sessionId).owner_id=owner.id;records.get(sessionId).expires_at=0;
 assert.equal((await request({op:'call',sessionId,body:{action:'bootstrap'}})).status,401);
});
test('status does not create sessions and SMS is throttled within a session',async()=>{
 const {request,records}=setup();
 assert.equal((await (await request({op:'status'})).json()).result.loggedIn,false);
 assert.equal(records.size,0);
 const first=await(await request({op:'sms',body:{phone:'+10000000000'}})).json();
 assert.equal((await request({op:'sms',sessionId:first.sessionId,body:{phone:'+10000000000'}})).status,429);
});
