const encoder=new TextEncoder();
function bytesToBase64(bytes){return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));}
function base64ToBytes(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
async function importKey(hex){
  if(typeof hex!=='string'||!/^[a-f0-9]{64}$/i.test(hex))throw new Error('Invalid session encryption key');
  return crypto.subtle.importKey('raw',Uint8Array.from(hex.match(/../g),x=>parseInt(x,16)),'AES-GCM',false,['encrypt','decrypt']);
}
export async function encrypt(value,key,owner){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(owner)},await importKey(key),encoder.encode(JSON.stringify(value)));
  return bytesToBase64(iv)+'.'+bytesToBase64(new Uint8Array(ciphertext));
}
export async function decrypt(value,key,owner){
  const [iv,ciphertext]=value.split('.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(iv),additionalData:encoder.encode(owner)},await importKey(key),base64ToBytes(ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
