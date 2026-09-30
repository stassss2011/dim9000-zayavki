import { ApiError, DimClient } from './client.js';
import { encrypt, decrypt } from './crypto.js';
import { Service } from './service.js';

const TTL=30*24*60*60*1000;
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const error=(status,message)=>{throw new ApiError(status,{message});};

export async function handle(req,{authenticate,repoFactory,getSecret,clientFactory=opts=>new DimClient(opts)}){
 try{
  if(req.method!=='POST')return response({error:{message:'POST required'}},405);
  let user;try{user=await authenticate();}catch{error(401,'Увійдіть у Base44');}
  if(!user)error(401,'Увійдіть у Base44');
  const owner=getSecret('OWNER_EMAIL');
  if(!owner)error(503,'Власника застосунку ще не налаштовано');
  if(String(user.email||'').toLowerCase()!==owner.toLowerCase())error(403,'Цей кабінет доступний лише власнику');
  if(!req.headers.get('content-type')?.startsWith('application/json'))error(415,'JSON required');
  if(Number(req.headers.get('content-length'))>15*1024*1024)error(413,'Request too large');
  // Bound streamed input as Content-Length can be omitted or forged.
  const reader=req.body?.getReader();let size=0,chunks=[];
  if(!reader)error(400,'JSON required');
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15*1024*1024){await reader.cancel();error(413,'Request too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let b;try{b=JSON.parse(new TextDecoder().decode(bytes));}catch{error(400,'Invalid JSON');}
  if(!b||typeof b!=='object'||Array.isArray(b))error(400,'JSON object required');
  if(!['status','sms','login','logout','call'].includes(b.op))error(400,'Unknown operation');
  if(b.body!==undefined&&(!b.body||typeof b.body!=='object'||Array.isArray(b.body)))error(400,'Invalid request body');
  const repo=repoFactory();let row=null;
  if(typeof b.sessionId==='string'&&/^[a-z0-9-]{16,80}$/i.test(b.sessionId)){
   try{row=await repo.get(b.sessionId);}catch(e){if((e.status||e.response?.status)!==404)throw e;}
   if(row&&row.owner_id!==user.id)error(401,'Сесія недоступна. Увійдіть знову.');
   if(row&&row.expires_at<Date.now()){await repo.delete(row.id);row=null;}
  }
  if(b.op==='status')return response({result:{loggedIn:!!row?.encrypted_tokens}});
  if(b.op==='logout'){if(row)await repo.delete(row.id);return response({result:{ok:true},sessionId:null});}
  if(!row&&b.op==='call')error(401,'Увійдіть через SMS');
  if(!row)row=await repo.create({owner_id:user.id,encrypted_tokens:'',expires_at:Date.now()+TTL,uploads:[],last_sms:0,login_attempts:0,attempt_window:Date.now()});
  const key=getSecret('SESSION_ENCRYPTION_KEY');
  if(!key)error(503,'Шифрування сесій не налаштоване');
  const binding=user.id+':'+row.id;
  let tokens=null;
  if(row.encrypted_tokens){try{tokens=await decrypt(row.encrypted_tokens,key,binding);}catch{error(401,'Сесія недійсна. Вийдіть і увійдіть знову.');}}
  const c=clientFactory({clientId:getSecret('DIM9000_CLIENT_ID'),clientSecret:getSecret('DIM9000_CLIENT_SECRET'),tokens,
   save:async value=>{await repo.update(row.id,{encrypted_tokens:value?await encrypt(value,key,binding):'',expires_at:Date.now()+TTL});}});
  const body=b.body||{};let result;
  if(b.op==='sms'){
   if(Date.now()-row.last_sms<60000)error(429,'Зачекайте хвилину перед повторним SMS');
   await repo.update(row.id,{last_sms:Date.now()});
   await c.requestSms(body.phone);result={ok:true};
  }else if(b.op==='login'){
   const attempts=Date.now()-row.attempt_window>15*60000?0:row.login_attempts;
   if(attempts>=10)error(429,'Забагато спроб. Зачекайте 15 хвилин.');
   await repo.update(row.id,{login_attempts:attempts+1,attempt_window:attempts===0?Date.now():row.attempt_window});
   await c.login(body.phone,body.code);result={ok:true};
  }else{
   const service=new Service(c,row.uploads||[]);result=await service.call(body);
   if(body.action==='upload')await repo.update(row.id,{uploads:[...service.uploads].slice(-100)});
  }
  return response({result,sessionId:row.id});
 }catch(e){
  if(e instanceof ApiError)return response({error:e.data},e.status);
  // SDK/network exceptions may contain request headers: never echo or log them.
  return response({error:{message:'Помилка сервера. Якщо надсилали зміни, оновіть дані перед повтором.'}},500);
 }
}
