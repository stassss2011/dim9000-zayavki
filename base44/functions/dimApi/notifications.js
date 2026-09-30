const iri=v=>typeof v==='object'&&v!==null?v['@id']:v;
function object(v){try{if(typeof v==='string')v=JSON.parse(v);}catch{return {};}return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
export function belongsToOrder(n,kind,id){
 const relation=kind==='orders'?'order':'paidOrder',opposite=kind==='orders'?'paidOrder':'order';
 if(n[relation])return iri(n[relation])==='/api/'+kind+'/'+id;
 if(n[opposite])return false;
 const p=object(n.payload),type=String(p.type||n.type||''),prefix=kind==='orders'?'order':'paid_order';
 return (type===prefix||type.startsWith(prefix+'_'))&&String(p.objectId)===String(id);
}
export async function orderNotifications(c,kind,id){
 const data=[],seen=new Set();
 for(let page=1;page<=1000;page++){
  const collection=await c.request('GET','notifications?'+new URLSearchParams({page,itemsPerPage:100,'order[createdAt]':'desc'}));
  for(const n of collection['hydra:member']||[]){
   const key=n.id||n['@id'];
   if(seen.has(key)||!belongsToOrder(n,kind,id))continue;
   seen.add(key);const p=object(n.payload);
   data.push({id:key,type:n.type,createdAt:n.createdAt,comment:p.comment||'',newDeadline:p.newDeadline,status:p.objectStatus||n.status,transition:object(p.transition),payload:p});
  }
  if(!collection['hydra:view']?.['hydra:next'])return {data,total:data.length};
 }
 throw new Error('Забагато сторінок сповіщень: повне завантаження не завершено');
}
