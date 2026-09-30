const CACHE='dim9000-shell-__BUILD_ID__';
const ASSETS=['/offline.html','/style.css','/app.js','/pwa.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 for(const path of ASSETS){
  const response=await fetch(path,{cache:'reload'});
  if(response.ok&&!response.redirected)await cache.put(path,response);
 }
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('dim9000-shell-')&&key!==CACHE)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 // Never intercept APIs, backend functions, attachments or auth callbacks.
 if(event.request.mode==='navigate'&&url.pathname==='/'&&!url.search){
  event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));return;
 }
 if(!ASSETS.includes(url.pathname)||url.search)return;
 event.respondWith((async()=>{
  try{
   const response=await fetch(event.request);
   if(response.ok&&!response.redirected){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());}
   return response;
  }catch{return (await caches.match(event.request))||Response.error();}
 })());
});
