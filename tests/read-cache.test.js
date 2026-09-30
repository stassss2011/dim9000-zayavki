import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadCache} from '../static/read-cache.js';

test('deduplicates pending reads, clones results, and expires cached data',async()=>{
 let count=0,time=0,resolve;
 const cache=createReadCache(()=>{count++;return new Promise(r=>resolve=r);},{now:()=>time,ttl:10});
 const first=cache.call({action:'detail',id:1}),second=cache.call({id:1,action:'detail'});
 await Promise.resolve();assert.equal(count,1);resolve({order:{id:1}});
 const a=await first,b=await second;a.order.id=9;assert.equal(b.order.id,1);
 assert.equal((await cache.call({action:'detail',id:1})).order.id,1);
 time=11;const expired=cache.call({action:'detail',id:1});await Promise.resolve();assert.equal(count,2);resolve({order:{id:2}});await expired;
});
test('writes never deduplicate or retry and invalidate reads even on failure',async()=>{
 let reads=0,writes=0;
 const cache=createReadCache(async body=>{if(body.action==='detail')return ++reads;writes++;throw Error('uncertain result');});
 await cache.call({action:'detail'});
 await assert.rejects(cache.call({action:'message'}));
 assert.equal(writes,1);assert.equal(await cache.call({action:'detail'}),2);
 await assert.rejects(cache.call({action:'message'}));assert.equal(writes,2);
});
test('cleared in-flight reads cannot repopulate the cache; failures are not cached',async()=>{
 let count=0,resolve;
 const cache=createReadCache(()=>{count++;if(count===1)return new Promise(r=>resolve=r);if(count===2)throw Error('offline');return 'fresh';});
 const pending=cache.call({action:'list'});await Promise.resolve();cache.clear();resolve('old');await pending;
 await assert.rejects(cache.call({action:'list'}));
 assert.equal(await cache.call({action:'list'}),'fresh');assert.equal(count,3);
});
