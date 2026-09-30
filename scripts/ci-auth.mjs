import { mkdir,writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const app=process.env.BASE44_APP_ID,token=process.env.BASE44_DEPLOY_TOKEN;
if(!app||!token)throw new Error('Configure BASE44_APP_ID and BASE44_DEPLOY_TOKEN in GitHub Actions first');
await mkdir('base44',{recursive:true});
await writeFile('base44/.app.jsonc',JSON.stringify({id:app}));
const dir=join(homedir(),'.base44','auth');await mkdir(dir,{recursive:true,mode:0o700});
// A scoped personal access token is a Bearer credential. The pinned CLI reads
// this format; it must not try to refresh a personal token as an OAuth grant.
await writeFile(join(dir,'auth.json'),JSON.stringify({accessToken:token,refreshToken:'not-an-oauth-session',expiresAt:Date.now()+24*60*60*1000,email:'ci@example.test',name:'GitHub Actions'}),{mode:0o600});
