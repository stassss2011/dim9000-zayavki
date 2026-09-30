'use strict';
if('serviceWorker' in navigator&&window.isSecureContext){
 navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
let installPrompt;
const install=document.getElementById('install');
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;install.hidden=false;});
install.onclick=async()=>{if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;install.hidden=true;};
window.addEventListener('appinstalled',()=>{install.hidden=true;});
const offline=document.getElementById('offline');
function connectivity(){offline.hidden=navigator.onLine;}
window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);connectivity();
