import { readFile,writeFile,mkdir,copyFile,rm,rename,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

let appId=process.env.BASE44_APP_ID||process.env.VITE_BASE44_APP_ID;
if(!appId){try{appId=JSON.parse((await readFile('base44/.app.jsonc','utf8')).replace(/^\s*\/\/.*$/gm,'')).id;}catch{}}
if(!appId||!/^[a-zA-Z0-9_-]+$/.test(appId))throw new Error('Set BASE44_APP_ID before building');
await rm('dist',{recursive:true,force:true});await mkdir('dist');
// Deliberate allowlist: never copy backend, .local, source maps or credentials.
const files=['index.html','app.js','style.css','pwa.js','sw.js','offline.html','manifest.webmanifest','icon-192.png','icon-512.png'];
for(const file of files)await copyFile('static/'+file,'dist/'+file);
let html=(await readFile('dist/index.html','utf8')).replace('<script type="module" src="/app.js"></script>','<script type="module" src="/hosted.js"></script>');
await build({entryPoints:['static/app.js'],outfile:'dist/app.js',bundle:true,format:'esm'});
await build({entryPoints:['web/hosted.js'],outfile:'dist/hosted.js',bundle:true,format:'esm',minify:true,define:{BASE44_APP_ID:JSON.stringify(appId)},external:['/app.js']});
// Hosting caches assets for an hour. Content names also invalidate the adapter
// when its imported app changes, without caching private responses in the worker.
const digest=content=>createHash('sha256').update(content).digest('hex').slice(0,16);
let sw=await readFile('dist/sw.js','utf8');
for(const file of ['app.js','style.css','pwa.js','hosted.js']){
 const name=file.replace(/(\.[^.]+)$/,'.'+digest(await readFile('dist/'+file))+'$1');
 await rename('dist/'+file,'dist/'+name);
 html=html.replaceAll('/'+file,'/'+name);
 sw=sw.replaceAll('/'+file,'/'+name);
 if(file==='app.js')await writeFile('dist/hosted.js',(await readFile('dist/hosted.js','utf8')).replaceAll('/app.js','/'+name));
}
await writeFile('dist/index.html',html);
const hash=createHash('sha256');
for(const file of (await readdir('dist')).sort())hash.update(await readFile('dist/'+file));
await writeFile('dist/sw.js',sw.replace('__BUILD_ID__',hash.digest('hex').slice(0,16)));
console.log('Built PWA: '+files.length+' static files and hosted adapter.');
