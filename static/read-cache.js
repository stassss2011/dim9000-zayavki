// Short-lived, bounded memory only. Private data never enters browser storage.
export function createReadCache(send,{ttl=15000,limit=80,now=Date.now}={}){
 const reads=new Set(['bootstrap','list','detail','history','chat','notifications','catalog']);
 const entries=new Map();
 const clear=()=>entries.clear();
 async function call(body){
  if(!reads.has(body.action)){
   clear();
   try{return await send(body);}finally{clear();}
  }
  const key=JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b))));
  const cached=entries.get(key);
  if(cached&&(cached.pending||cached.expires>now()))return structuredClone(await cached.promise);
  const entry={pending:true,expires:0};
  entry.promise=Promise.resolve().then(()=>send(body)).then(value=>{
   entry.pending=false;entry.expires=now()+ttl;return value;
  }).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
  entries.delete(key);entries.set(key,entry);
  while(entries.size>limit)entries.delete(entries.keys().next().value);
  return structuredClone(await entry.promise);
 }
 return {call,clear};
}
