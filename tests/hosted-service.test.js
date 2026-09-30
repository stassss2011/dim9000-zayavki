import test from 'node:test';
import assert from 'node:assert/strict';
import { Service } from '../base44/functions/dimApi/service.js';

function client(handler){return {request:handler};}
const spaces={'hydra:member':[{'@id':'/api/apartments/example'}]};
const order={'@id':'/api/orders/42',id:42,space:'/api/apartments/example'};

test('rejects another residents order before related entities are requested',async()=>{
 const calls=[];
 const s=new Service(client(async(method,path)=>{calls.push(path);return path.startsWith('spaces/')?spaces:{...order,space:'/api/apartments/other'};}));
 await assert.rejects(s.call({action:'history',id:42}),e=>e.status===403);
 assert.equal(calls.length,2);
});
test('search uses keyword_search and history uses orderId',async()=>{
 let seen='';
 const s=new Service(client(async(method,path)=>{
   if(path.startsWith('spaces/'))return spaces;
   if(path==='orders/42')return order;
   seen=path;return {'hydra:member':[]};
 }));
 await s.call({action:'list',search:'42'});
 assert.equal(new URLSearchParams(seen.split('?')[1]).get('keyword_search'),'42');
 await s.call({action:'history',id:42});
 assert.equal(new URLSearchParams(seen.split('?')[1]).get('orderId'),'42');
});
test('collects all notification pages without crossing order relations',async()=>{
 const s=new Service(client(async(method,path)=>{
   assert.equal(method,'GET');
   if(path.startsWith('spaces/'))return spaces;
   if(path==='orders/42')return order;
   const page=new URLSearchParams(path.split('?')[1]).get('page');
   if(page==='1')return {'hydra:member':[{'id':'other',order:'/api/orders/99'}],'hydra:view':{'hydra:next':'?page=2'}};
   return {'hydra:member':[{id:'mine',type:'order_deadline_updated',order:'/api/orders/42',payload:{comment:'Synthetic update',newDeadline:'2030-01-01'}},{id:'paid',order:null,paidOrder:'/api/paid-orders/42',payload:{objectId:42,type:'order'}}]};
 }));
 const result=await s.call({action:'notifications',id:42});
 assert.equal(result.total,1);assert.equal(result.data[0].comment,'Synthetic update');
});
test('create requires an owned space and uploaded file provenance',async()=>{
 let writes=0;
 const s=new Service(client(async(method)=>{if(method!=='GET')writes++;return spaces;}));
 await assert.rejects(s.call({action:'create',data:{space:'/api/apartments/other',description:'test',category:'other'}}));
 await assert.rejects(s.call({action:'create',data:{space:'/api/apartments/example',description:'test',category:'other',gallery:{files:['/api/files/not-uploaded']}}}));
 assert.equal(writes,0);
});
test('ratings preserve backend validation errors without changing status',async()=>{
 const s=new Service(client(async(method,path)=>{
   if(path.startsWith('spaces/'))return spaces;
   if(path==='orders/42')return {...order,status:'canceled'};
   assert.equal(path,'reviews');assert.equal(method,'POST');
   throw Object.assign(new Error('validation'),{status:422});
 }));
 await assert.rejects(s.call({action:'review',id:42,data:{rating:1,comment:'test'}}),e=>e.status===422);
});
