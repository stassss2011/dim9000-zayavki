const BASES = {main:'https://api.dim9000.com/api/',chat:'https://api-messaging.dim9000.com/api/'};
const RESOURCES = {main:new Set(['orders','paid-orders','reviews','paid-reviews','paid-order-names','spaces','files','galleries','history','notifications']),chat:new Set(['topics','messages'])};

export class ApiError extends Error {
  constructor(status,data) {super('API HTTP '+status);this.status=status;this.data=data;}
}
export function validatePath(path,service='main') {
  if(typeof path!=='string'||!BASES[service])throw new Error('Invalid API path');
  const part=decodeURIComponent(path.split('?')[0]);
  if(!/^[A-Za-z0-9_./-]+$/.test(part)||path.includes('#')||part.startsWith('/')||part.split('/').includes('..')||!RESOURCES[service].has(part.split('/')[0]))throw new Error('API path is outside the issue module');
  return path;
}
export class DimClient {
  constructor({clientId,clientSecret,tokens=null,save=async()=>{},fetcher=fetch}={}) {
    Object.assign(this,{clientId,clientSecret,tokens,save,fetcher});
  }
  async transport(method,path,{service='main',token,data,form=false,raw}={}) {
    const headers={Accept:service==='main'?'application/ld+json':'application/json','User-Agent':'dim9000-zayavki/1.0'};
    if(token)headers.Authorization='Bearer '+token;
    let body=raw;
    if(data!==undefined){
      body=form?new URLSearchParams(data):JSON.stringify(data);
      headers['Content-Type']=form?'application/x-www-form-urlencoded':method==='PATCH'&&service==='main'?'application/merge-patch+json':service==='main'?'application/ld+json':'application/json';
    }
    let response;
    try {response=await this.fetcher(BASES[service]+path,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(30000)});}
    catch {throw new ApiError(504,{message:'Не вдалося отримати відповідь DIM9000. Якщо це була зміна, оновіть дані перед повтором: сервер міг уже її виконати.'});}
    if(response.status>=300&&response.status<400)throw new ApiError(502,{message:'DIM9000 повернув неочікуване перенаправлення; запит не повторювався'});
    const text=await response.text();
    let result=null;
    try {result=text?JSON.parse(text):null;}catch{throw new ApiError(response.ok?502:response.status,{message:'DIM9000 повернув відповідь не у форматі JSON'});}
    if(!response.ok)throw new ApiError(response.status,result||{message:'Помилка DIM9000'});
    return result;
  }
  grant(fields){
    if(!this.clientId||!this.clientSecret)throw new ApiError(503,{message:'OAuth не налаштований на сервері'});
    return this.transport('POST','token',{form:true,data:{client_id:this.clientId,client_secret:this.clientSecret,...fields}});
  }
  async persist(tokens){
    this.tokens=tokens?{...tokens,refresh_token:tokens.refresh_token||this.tokens?.refresh_token,expires_at:Date.now()+Number(tokens.expires_in||0)*1000}:null;
    await this.save(this.tokens);
    return this.tokens;
  }
  async refresh(){
    if(!this.tokens?.refresh_token)throw new ApiError(401,{message:'Увійдіть через SMS'});
    let result;
    try{result=await this.grant({grant_type:'refresh_token',refresh_token:this.tokens.refresh_token});}
    catch(e){if([400,401,403].includes(e.status))await this.persist(null);throw e;}
    return this.persist(result);
  }
  async request(method,path,data,service='main',options={}){
    validatePath(path,service);
    if(!this.tokens)throw new ApiError(401,{message:'Увійдіть через SMS'});
    if(this.tokens.expires_at<Date.now()+60000)await this.refresh();
    try{return await this.transport(method,path,{service,token:this.tokens.access_token,data,...options});}
    catch(e){
      if(e.status!==401)throw e;
      await this.refresh();
      return this.transport(method,path,{service,token:this.tokens.access_token,data,...options});
    }
  }
  validatePhone(phone){if(typeof phone!=='string'||!/^\+[0-9]{10,15}$/.test(phone))throw new ApiError(400,{message:'Введіть номер у форматі +380…'});}
  async requestSms(phone){
    this.validatePhone(phone);
    const temp=await this.grant({grant_type:'client_credentials'});
    await this.transport('POST','users/phone-verification',{token:temp.access_token,data:{phone}});
  }
  async login(phone,code){
    this.validatePhone(phone);
    if(typeof code!=='string'||!/^\d{4,8}$/.test(code))throw new ApiError(400,{message:'Перевірте SMS-код'});
    const temp=await this.grant({grant_type:'client_credentials'});
    await this.transport('POST','users/code-check',{token:temp.access_token,data:{phone,code}});
    await this.persist(await this.grant({grant_type:'sms',username:phone,smsCode:code}));
  }
}
