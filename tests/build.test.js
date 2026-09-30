import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, readdir, appendFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('hosted updates get fresh asset URLs and never include local state', async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'dim-build-'));
 try{
  for(const dir of ['static','web'])await cp(dir,join(cwd,dir),{recursive:true});
  await symlink(resolve('node_modules'),join(cwd,'node_modules'),'dir');
  const build=()=>execFileSync(process.execPath,[resolve('scripts/build.mjs')],{cwd,env:{...process.env,BASE44_APP_ID:'test-app'}});
  build();
  const first=await readdir(join(cwd,'dist'));
  const app=first.find(name=>/^app\.[a-f0-9]+\.js$/.test(name));
  const hosted=first.find(name=>/^hosted\.[a-f0-9]+\.js$/.test(name));
  assert.ok(app);assert.ok(hosted);
  assert.ok((await readFile(join(cwd,'dist',hosted),'utf8')).includes('/'+app));
  const html=await readFile(join(cwd,'dist/index.html'),'utf8');
  for(const url of html.matchAll(/(?:src|href)="\/([^"?#]+)"/g))assert.ok(first.includes(url[1]),url[1]);
  const sw=await readFile(join(cwd,'dist/sw.js'),'utf8');
  assert.ok(sw.includes('/'+app));assert.ok(!sw.includes('__BUILD_ID__'));
  assert.ok(!first.some(name=>/^(?:app|hosted|pwa)\.js$/.test(name)));
  assert.ok(!first.some(name=>name.startsWith('.')||name.endsWith('.map')));
  await appendFile(join(cwd,'static/app.js'),'\n// new release\n');
  build();
  const second=await readdir(join(cwd,'dist'));
  assert.ok(!second.includes(app));assert.ok(!second.includes(hosted));
 }finally{await rm(cwd,{recursive:true,force:true});}
});
