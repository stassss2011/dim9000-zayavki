import { ApiError } from './client.js';
import { orderNotifications } from './notifications.js';

export const CATEGORIES=Object.fromEntries('cleaning water_supply elevator heating fire_protection_system ventilation sewerage electricity repairs intercom_and_video client_service adjacent_territory protection financial_issues other'.split(' ').map((k,i)=>[k,['Прибирання','Водопостачання','Ліфт','Опалення','Протипожежна система','Вентиляція','Каналізація','Електроенергія','Ремонтні роботи','Домофон, відео, СКД','Клієнт-сервіс','Будинок та територія','Охорона','Фінансові питання','Інше'][i]]));
const iri=v=>v&&typeof v==='object'?v['@id']:v;
const fail=message=>{throw new ApiError(400,{message});};
const page=v=>Math.max(1,Math.min(10000,Number.parseInt(v||1,10)||1));
const kindOf=b=>{const kind=b.kind||'orders';if(!['orders','paid-orders'].includes(kind))fail('Невідомий тип заявки');return kind;};

export class Service {
 constructor(client,uploads=[]){this.client=client;this.uploads=new Set(uploads);}
 async spaces(){return (await this.client.request('GET','spaces/my-spaces?itemsPerPage=1000'))['hydra:member']||[];}
 async context(b){
  const kind=kindOf(b),id=String(b.id||'');if(!/^\d+$/.test(id))fail('Невірний номер заявки');
  const path=kind+'/'+id,order=await this.client.request('GET',path);
  if(!(await this.spaces()).some(s=>s['@id']===iri(order.space)))throw new ApiError(403,{message:'Заявка не належить вашим об’єктам'});
  return {path,order,kind};
 }
 checkFiles(files,existing=[]){
  if(!Array.isArray(files)||files.length>5||files.some(f=>typeof f!=='string'))fail('Дозволено до 5 фотографій');
  if(files.some(f=>!this.uploads.has(f)&&!existing.includes(f)))fail('Спочатку завантажте фотографії через цю сторінку');
 }
 async call(b){
  const c=this.client,action=b.action;
  if(action==='bootstrap')return {spaces:await this.spaces(),categories:CATEGORIES};
  if(action==='list'){
   const kind=kindOf(b),spaces=await this.spaces(),selected=b.space||spaces[0]?.['@id'];
   if(!spaces.some(s=>s['@id']===selected))fail('Оберіть ваш об’єкт');
   const q=new URLSearchParams({page:page(b.page),itemsPerPage:20,'order[createdAt]':'desc',space:selected});
   for(const key of ['status','category'])if(b[key])q.set(key,String(b[key]));
   if(b.search)q.set(kind==='orders'?(/^[0-9]+$/.test(String(b.search))?'id':'keyword_search'):'search',String(b.search));
   for(const status of b.group==='active'?['new','consideration','in_progress','not_paid','processing_refunds']:b.group==='finished'?['completed','canceled']:[])q.append('status[]',status);
   return c.request('GET',kind+'?'+q);
  }
  if(action==='catalog'){
   const spaces=await this.spaces(),s=spaces.find(x=>x['@id']===b.space)||spaces[0];
   if(!s)fail('Немає доступних об’єктів');
   return c.request('GET','paid-order-names?'+new URLSearchParams({'complexes.id':String(iri(s.complex)).split('/').pop(),itemsPerPage:1000}));
  }
  if(action==='upload'){
   if(typeof b.data!=='string'||b.data.length>14*1024*1024)fail('Файл завеликий');
   let bytes;try{bytes=Uint8Array.from(atob(b.data),x=>x.charCodeAt(0));}catch{fail('Невірний формат файлу');}
   if(!bytes.length||bytes.length>10*1024*1024)fail('Файл має бути від 1 байта до 10 МБ');
   if(!['image/jpeg','image/png','image/webp'].includes(b.mime))fail('Підтримуються JPEG, PNG та WebP');
   const name=String(b.name||'photo.jpg').replace(/[^\p{L}\p{N}_. -]/gu,'_').slice(0,150),raw=new FormData();
   raw.set('originalName',name);raw.set('file',new Blob([bytes],{type:b.mime}),name);
   const result=await c.request('POST','files/order/media/upload',undefined,'main',{raw});
   this.uploads.add(result['@id']);return result;
  }
  if(action==='create'){
   const kind=kindOf(b),d=b.data||{};
   if(!(await this.spaces()).some(s=>s['@id']===d.space))fail('Оберіть ваш об’єкт');
   if(!String(d.description||'').trim())fail('Додайте опис');
   if(kind==='orders'&&!Object.hasOwn(CATEGORIES,d.category))fail('Оберіть категорію');
   this.checkFiles(d.gallery?.files||[]);
   const keys=kind==='orders'?['space','description','category','gallery']:['space','description','name'];
   return c.request('POST',kind,Object.fromEntries(Object.entries(d).filter(([k])=>keys.includes(k))));
  }
  const {path,order,kind}=await this.context(b);
  if(action==='notifications')return orderNotifications(c,kind,order.id);
  if(action==='detail'){
   if(typeof order.review==='string')order.review=await c.request('GET',order.review.replace(/^\/api\//,''));
   return {order,transitions:await c.request('GET',path+'/transit')};
  }
  if(action==='history'){
   const resource=kind==='orders'?'order-updates':'paid-order-updates';
   const result=await c.request('GET','history/'+resource+'?'+new URLSearchParams({orderId:order.id,itemsPerPage:100,page:page(b.page),'order[createdAt]':'asc'}));
   result['hydra:member']=(result['hydra:member']||[]).filter(x=>iri(x.order)===order['@id']);return result;
  }
  if(action==='update'){
   const d=b.data||{},keys=kind==='orders'?['description','category']:['description'];
   if(!Object.keys(d).length||Object.keys(d).some(k=>!keys.includes(k)))fail('Можна змінити опис і категорію');
   return c.request('PUT',path,d);
  }
  if(action==='transition'){
   if(!(await c.request('GET',path+'/transit')).includes(b.transition))fail('Ця дія недоступна для поточного статусу');
   return c.request('PATCH',path+'/transit',{transition:b.transition});
  }
  if(action==='review'){
   const rating=Number(b.data?.rating);if(!Number.isInteger(rating)||rating<1||rating>5)fail('Оцінка має бути від 1 до 5');
   const data={rating,comment:String(b.data?.comment||'')};
   if(order.review)return c.request('PATCH',iri(order.review).replace(/^\/api\//,''),data);
   return c.request('POST',kind==='orders'?'reviews':'paid-reviews',{...data,order:order['@id']});
  }
  if(action==='gallery'){
   const files=b.files||[],gallery=order.gallery;this.checkFiles(files,(gallery?.files||[]).map(iri));
   if(!gallery)fail('Галерея для цієї заявки недоступна');
   return c.request('PATCH',iri(gallery).replace(/^\/api\//,''),{files});
  }
  if(['chat','message','edit_message','topic'].includes(action)){
   let topic=order.topicId;
   if(!topic){
    const topics=await c.request('GET','topics?'+new URLSearchParams({filter:'externalId||$eq||'+order.id,limit:100}),undefined,'chat');
    topic=(topics.data||[]).find(t=>[String(order.id),order['@id']].includes(String(t.externalId)))?.id;
   }
   if(!topic&&['topic','message'].includes(action)){
    if(kind!=='orders')fail('Створення чату платної заявки не знайдено в API застосунку');
    topic=(await c.request('POST','orders/chat/topic',{order:order['@id']})).topicId;
   }
   if(!topic)return {data:[],total:0,pageCount:0,topicId:null};
   if(action==='topic')return {topicId:topic};
   if(action==='chat'){
    const result=await c.request('GET','messages?'+new URLSearchParams({filter:'topic.id||$eq||'+topic,sort:'createdAt,DESC',page:page(b.page),limit:30}),undefined,'chat');
    result.data=(result.data||[]).filter(m=>(m.topicId??m.topic?.id)===topic);result.topicId=topic;return result;
   }
   if(!String(b.text||'').trim())fail('Напишіть повідомлення');
   if(action==='message')return c.request('POST','messages',{type:'text',body:b.text,topic},'chat');
   const id=String(b.messageId||'');if(!/^\d+$/.test(id))fail('Невірний номер повідомлення');
   const m=await c.request('GET','messages/'+id,undefined,'chat');
   if((m.topicId??m.topic?.id)!==topic)fail('Повідомлення належить іншій заявці');
   return c.request('PATCH','messages/'+id,{body:String(b.text)},'chat');
  }
  fail('Невідома дія');
 }
}
