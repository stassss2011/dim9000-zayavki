import test from 'node:test';
import assert from 'node:assert/strict';
import { DimClient, ApiError, validatePath } from '../base44/functions/dimApi/client.js';
import { encrypt, decrypt } from '../base44/functions/dimApi/crypto.js';

test('encrypted sessions cannot be read with another key or owner', async () => {
  const key = '11'.repeat(32);
  const blob = await encrypt({access_token:'synthetic'}, key, 'owner-a');
  assert.ok(!blob.includes('synthetic'));
  assert.deepEqual(await decrypt(blob,key,'owner-a'),{access_token:'synthetic'});
  await assert.rejects(decrypt(blob,key,'owner-b'));
  await assert.rejects(decrypt(blob,'22'.repeat(32),'owner-a'));
});

test('API paths reject external URLs, traversal, auth and unrelated modules', () => {
  for (const p of ['https://evil.test','//evil.test','../token','orders/%2e%2e/token','orders/%252e%252e/token','token','access-points/1/open','orders/1#x']) {
    assert.throws(() => validatePath(p,'main'));
  }
  assert.equal(validatePath('orders?page=1','main'),'orders?page=1');
});

test('refresh persists rotated credentials before the resource is read', async () => {
  const saved = [];
  const c = new DimClient({clientId:'test',clientSecret:'test',tokens:{refresh_token:'old',expires_at:0},save:async t=>saved.push(t)});
  c.transport = async (method,path,options) => {
    if (path==='token') return {access_token:'new',refresh_token:'rotated',expires_in:3600};
    assert.equal(saved[0].refresh_token,'rotated');
    assert.equal(options.token,'new');
    return {ok:true};
  };
  assert.deepEqual(await c.request('GET','orders'),{ok:true});
});

test('uncertain writes are not retried and transient refresh keeps credentials', async () => {
  let calls=0;
  const c = new DimClient({tokens:{access_token:'x',refresh_token:'r',expires_at:Date.now()+100000},save:async()=>{}});
  c.transport=async()=>{calls++;throw new ApiError(504,{message:'timeout'});};
  await assert.rejects(c.request('POST','orders',{description:'synthetic'}));
  assert.equal(calls,1);
  assert.equal(c.tokens.refresh_token,'r');
});

test('rejects redirects without forwarding credentials', async () => {
  const c = new DimClient({fetcher:async (url,opts)=>{
    assert.equal(opts.redirect,'error');
    throw new TypeError('redirect');
  }});
  await assert.rejects(c.transport('GET','orders',{token:'synthetic'}),e=>e.status===504);
});
