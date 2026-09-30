import { createClient } from '@base44/sdk';

const client=createClient({appId:BASE44_APP_ID});
const user=await client.auth.me().catch(()=>null);
if(!user){
  document.getElementById('login').innerHTML='<h2>Приватний кабінет</h2><p>Увійдіть у свій Base44 акаунт, щоб відкрити заявки.</p><button id="base44Login">Увійти через Google</button>';
  document.getElementById('login').hidden=false;
  document.getElementById('base44Login').onclick=()=>client.auth.loginWithProvider('google',location.origin+'/');
}else{
 const storageKey='dim9000-session:'+user.id;
 let queue=Promise.resolve();
 const invoke=async(path,body)=>{
  if(!navigator.onLine)throw new Error('Немає інтернету. Зміни не надсилалися.');
  const op=path.replace('/api/','');
  try{
   const {data}=await client.functions.invoke('dimApi',{op,body,sessionId:localStorage.getItem(storageKey)});
   if(Object.hasOwn(data,'sessionId')){
    if(data.sessionId)localStorage.setItem(storageKey,data.sessionId);else localStorage.removeItem(storageKey);
   }
   return data.result;
  }catch(e){
   const upstream=e.response?.data?.error||e.data?.error;
   const message=typeof upstream==='string'?upstream:upstream?.['hydra:description']||upstream?.message||upstream?.detail;
   const err=new Error(message||'Не вдалося отримати відповідь. Якщо надсилали зміни, оновіть дані перед повтором.');
   err.status=e.response?.status||e.status;
   throw err;
  }
 };
 window.hostedRequest=(path,body)=>{
  // A single shared session per browser; serialize refresh across tabs too.
  const work=()=>navigator.locks?navigator.locks.request(storageKey,()=>invoke(path,body)):invoke(path,body);
  const current=queue.then(work,work);queue=current.catch(()=>{});return current;
 };
 await import('/app.js');
}
