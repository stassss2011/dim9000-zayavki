import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('service worker never intercepts private API, auth or attachment requests',()=>{
 const handlers={};
 vm.runInNewContext(readFileSync('static/sw.js','utf8'),{self:{location:{origin:'https://app.example.test'},addEventListener:(name,fn)=>handlers[name]=fn},URL});
 for(const [url,method] of [['/api/status','GET'],['/api/call','POST'],['/functions/dimApi','POST'],['/?access_token=synthetic','GET'],['https://media.example.test/photo.jpg','GET']]){
  let handled=false;
  handlers.fetch({request:{url:new URL(url,'https://app.example.test').href,method,mode:'navigate'},respondWith:()=>{handled=true;}});
  assert.equal(handled,false,url);
 }
});
