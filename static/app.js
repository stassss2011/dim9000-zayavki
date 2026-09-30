'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses = {new:'Нова',consideration:'В обробці',in_progress:'Виконується',completed:'Виконана',canceled:'Відхилена',not_paid:'Не оплачено',processing_refunds:'Повернення коштів'};
const fields = {status:'Статус',deadline:'Термін виконання',plannedDeadline:'Плановий термін',description:'Опис',category:'Категорія',type:'Тип',answer:'Відповідь',responsible:'Відповідальний',assignee:'Виконавець',validity:'Важливість',rating:'Оцінка',comment:'Коментар',gallery:'Вкладення',media:'Звітні вкладення',completedAt:'Виконано'};
const state = {page:1, boot:null, selected:null, order:null, history:[], messages:[], notifications:[], historyPage:1, chatPage:1, generation:0, listGeneration:0, draftFiles:[]};
const date = v => v ? (Number.isNaN(new Date(v).getTime()) ? String(v) : new Date(v).toLocaleString('uk-UA')) : '—';
const person = v => Array.isArray(v) ? v.map(person).join(', ') || '—' : typeof v === 'string' ? v : v?.name || [v?.lastName,v?.firstName,v?.patronymic].filter(Boolean).join(' ') || v?.role || '—';
const address = s => Object.values(s?.address || s?.addressData || {}).filter(v => v !== null).join(', ');
const context = () => ({kind:state.selected.kind,id:state.selected.id});
function notice(text, error=false) {$('notice').textContent=text;$('notice').hidden=!text;$('notice').className=error?'error':'';}
function errorText(error) {return typeof error==='string'?error: error?.['hydra:description'] || error?.message || error?.detail || JSON.stringify(error);}
async function request(path, body) {
  if(window.hostedRequest)return window.hostedRequest(path,body);
  const r = await fetch(path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) {const e=new Error(errorText(d.error||d));e.status=r.status;throw e;}
  return d;
}
const call = body => request('/api/call',body);
async function run(button, task) {
  if (button?.disabled) return;
  if (button) button.disabled=true;
  try {notice('');await task();} catch(e) {notice(e.message,true);} finally {if(button)button.disabled=false;}
}
function options(items, selected='') {return items.map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');}
async function start() {
  const status=await request('/api/status');$('login').hidden=status.loggedIn;$('app').hidden=!status.loggedIn;$('logout').hidden=!status.loggedIn;
  if(!status.loggedIn)return;
  try {
    state.boot=await call({action:'bootstrap'});
    if(!state.boot.spaces.length){notice('Для акаунта немає доступних об’єктів.');return;}
    const spaces=state.boot.spaces.map(s=>[s['@id'],address(s)||s.number||s['@id']]);
    $('space').innerHTML=$('createSpace').innerHTML=options(spaces);
    $('category').innerHTML=options([['','Усі'],...Object.entries(state.boot.categories)]);
    $('createCategory').innerHTML=options(Object.entries(state.boot.categories));
    $('connection').textContent='Підключено до DIM9000';await loadList();
  } catch(e) {if(e.status===401){$('login').hidden=false;$('app').hidden=true;}throw e;}
}
async function loadList() {
  const generation=++state.listGeneration;
  $('count').textContent='Завантаження…';
  const kind=$('kind').value;
  const d=await call({action:'list',kind,space:$('space').value,page:state.page,group:$('group').value,category:kind==='orders'?$('category').value:'',search:$('search').value.trim()});
  if(generation!==state.listGeneration)return;
  $('count').textContent=`Знайдено: ${d['hydra:totalItems'] ?? '—'}`;$('page').textContent=`Сторінка ${state.page}`;
  $('prev').disabled=state.page<=1;$('next').disabled=!d['hydra:view']?.['hydra:next'];
  $('list').innerHTML=(d['hydra:member']||[]).map(o=>{
    const overdue=o.deadline&&new Date(o.deadline)<new Date()&&!['completed','canceled'].includes(o.status);
    return `<article class="card ${state.selected?.id===o.id&&state.selected?.kind===kind?'selected':''}" tabindex="0" data-id="${esc(o.id)}">
      <h3>№ ${esc(o.id)} <span class="status">${esc(statuses[o.status]||o.status)}</span></h3>
      <p><small>${esc(date(o.createdAt))} · ${esc(state.boot.categories[o.category]||o.name?.name||'Платна послуга')}</small></p>
      <p>${esc(o.description)}</p>
      ${o.deadline?`<p class="${overdue?'overdue':'muted'}">Термін: ${esc(date(o.deadline))}${overdue?' · прострочено':''}</p>`:''}
      ${o.review?`<p>Оцінка: ${esc(o.review.rating)} / 5</p>`:''}${o.unreadMessagesCount?`<p>Нових повідомлень: ${esc(o.unreadMessagesCount)}</p>`:''}
    </article>`;
  }).join('')||'<p>Заявок за цими умовами немає.</p>';
  document.querySelectorAll('.card').forEach(card=>{
    const open=()=>run(null,async()=>{await openOrder(kind,Number(card.dataset.id));if(matchMedia('(max-width:950px)').matches)$('detail').scrollIntoView({behavior:'smooth'});});
    card.onclick=open;card.onkeydown=e=>{if(e.key==='Enter')open();};
  });
}
function fact(label,value){return `<dt>${esc(label)}</dt><dd>${esc(value??'—')}</dd>`;}
function safeURL(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
function photos(gallery) {
  return `<div class="photos">${(gallery?.files||[]).map(f=>{
    const href=safeURL(f.uri);if(!href)return `<span>${esc(f.originalName||f.name||f['@id'])}</span>`;
    return `<a href="${esc(href)}" target="_blank" rel="noreferrer">${String(f.mimeType||'').startsWith('image/')?`<img src="${esc(href)}" alt="${esc(f.originalName||'Фото заявки')}" loading="lazy">`:''}<small>${esc(f.originalName||f.name||'Відкрити файл')}</small></a>`;
  }).join('')||'<p class="muted">Немає вкладень.</p>'}</div>`;
}
async function openOrder(kind,id) {
  const generation=++state.generation;
  state.selected={kind,id};state.history=[];state.messages=[];state.notifications=[];state.historyPage=1;state.chatPage=1;state.historyError=null;state.chatError=null;
  $('detail').innerHTML='<p>Завантаження заявки…</p>';
  const result=await call({action:'detail',kind,id});if(generation!==state.generation)return;
  state.order=result.order;const o=state.order;
  document.querySelectorAll('.card').forEach(x=>x.classList.toggle('selected',Number(x.dataset.id)===id&&$('kind').value===kind));
  const review=typeof o.review==='object'?o.review:null;
  $('detail').innerHTML=`<div class="toolbar"><button id="backList" class="mobileOnly">← До списку</button><h2>Заявка № ${esc(o.id)}</h2><button id="refreshDetail">Оновити</button><button id="export">Зберегти повне зведення</button><button id="print">Друк / PDF</button></div>
    <dl class="facts">${fact('Статус',statuses[o.status]||o.status)}${fact('Категорія / послуга',state.boot.categories[o.category]||o.name?.name||o.name)}
    ${fact('Створено',date(o.createdAt))}${fact('Термін виконання',date(o.deadline))}${fact('Плановий термін',date(o.plannedDeadline))}
    ${fact('Виконано / закрито',date(o.completedAt))}${fact('Об’єкт',address(o.space)||address(o))}${fact('Відповідальний',person(o.responsible))}</dl>
    <h3>Звернення</h3><div class="pre">${esc(o.description)}</div>
    <h3>Відповідь / звіт про виконання</h3><div class="pre">${esc(o.answer||'Відповідь у заявці відсутня.')}</div>
    ${o.cancellationReason?`<h3>Причина відхилення</h3><div class="pre">${esc(o.cancellationReason)}</div>`:''}
    <h3>Фото до звернення</h3>${photos(o.gallery)}<h3>Фото / файли звіту</h3>${photos(o.media)}
    <h3>Оцінка заявки</h3>${review?`<p><strong>${esc(review.rating)} / 5</strong></p><div class="pre">${esc(review.comment)}</div>${review.validationComment?`<p>${esc(review.validationComment)}</p>`:''}`:'<p class="muted">Оцінки немає.</p>'}
    <details><summary>${review?'Змінити оцінку':'Залишити оцінку'}</summary><form id="reviewForm"><label>Оцінка <select name="rating">${options([1,2,3,4,5].map(x=>[String(x),`${x} / 5`]),String(review?.rating||5))}</select></label><label>Коментар <textarea name="comment" rows="3" maxlength="800">${esc(review?.comment||'')}</textarea></label><button>Зберегти оцінку</button></form></details>
    <h3>Сповіщення та пояснення УК</h3><p class="muted">Коментарі до перенесення термінів і зміни статусів із push-сповіщень. Новіші зверху.</p><div id="notifications">Завантаження…</div>
    <h3>Історія змін</h3><p class="muted">Статуси, перенесення термінів та інші зміни з журналу DIM9000.</p><div id="history">Завантаження…</div><button id="moreHistory" hidden>Ще зміни</button>
    <h3>Діалог за заявкою</h3><div id="chat">Завантаження…</div><button id="moreChat" hidden>Раніші повідомлення</button>
    <form id="messageForm"><label>Нове повідомлення <textarea name="text" rows="3" required></textarea></label><button>Надіслати</button></form>
    <details><summary>Редагування заявки</summary><p class="muted">API оголошує редагування, але може обмежувати його для мешканця або поточного статусу. Помилка сервера буде показана без повторного надсилання.</p><form id="editForm">
    ${kind==='orders'?`<label>Категорія <select name="category">${options(Object.entries(state.boot.categories),o.category)}</select></label>`:''}
    <label>Опис <textarea name="description" rows="6" required>${esc(o.description)}</textarea></label><button>Зберегти зміни</button></form></details>
    <details><summary>Усі поля відповіді API</summary><pre class="raw">${esc(JSON.stringify(o,null,2))}</pre></details>`;
  $('backList').onclick=()=>$('listPanel').scrollIntoView({behavior:'smooth'});
  $('refreshDetail').onclick=e=>run(e.currentTarget,()=>openOrder(kind,id));
  $('export').onclick=e=>run(e.currentTarget,exportOrder);$('print').onclick=()=>window.print();
  $('editForm').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const data=Object.fromEntries(new FormData(e.target));await call({action:'update',...context(),data});await openOrder(kind,id);await loadList();notice('Зміни збережено.');});};
  if($('reviewForm'))$('reviewForm').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const data=Object.fromEntries(new FormData(e.target));await call({action:'review',...context(),data});await openOrder(kind,id);notice('Оцінку збережено.');});};
  $('messageForm').onsubmit=e=>{e.preventDefault();const form=e.target;run(e.submitter,async()=>{await call({action:'message',...context(),text:new FormData(form).get('text')});form.reset();state.chatPage=1;state.messages=[];await loadChat(generation);notice('Повідомлення надіслано.');});};
  $('moreHistory').onclick=e=>run(e.currentTarget,async()=>{state.historyPage++;try{await loadHistory(generation);}catch(err){state.historyPage--;throw err;}});
  $('moreChat').onclick=e=>run(e.currentTarget,async()=>{state.chatPage++;try{await loadChat(generation);}catch(err){state.chatPage--;throw err;}});
  await Promise.allSettled([loadHistory(generation),loadChat(generation),loadNotifications(generation)]);
}
function notificationTitle(n) {
  if(n.type==='order_deadline_updated'||n.type==='paid_order_deadline_updated')return 'Зміна терміну виконання';
  if(n.transition?.to==='completed')return 'Заявка завершена';
  if(n.transition?.to)return 'Зміна статусу';
  return n.comment?'Коментар УК':'Сповіщення щодо заявки';
}
async function loadNotifications(generation) {
  try {
    const result=await call({action:'notifications',...context()});if(generation!==state.generation)return;
    state.notifications=result.data||[];
    $('notifications').innerHTML=state.notifications.map(n=>`<div class="event notification"><small>${esc(date(n.createdAt))}</small><p><strong>${esc(notificationTitle(n))}</strong></p>
      ${n.newDeadline?`<p>Новий термін: <strong>${esc(date(n.newDeadline))}</strong></p>`:''}
      ${n.transition?.to?`<p>${esc(statuses[n.transition.from]||n.transition.from||'—')} → ${esc(statuses[n.transition.to]||n.transition.to)}</p>`:n.status?`<p>Статус на момент сповіщення: ${esc(statuses[n.status]||n.status)}</p>`:''}
      ${n.comment?`<p class="pre notificationComment">${esc(n.comment)}</p>`:''}
      <details><summary>Дані сповіщення</summary><pre class="raw">${esc(JSON.stringify(n.payload,null,2))}</pre></details></div>`).join('')||'<p class="muted">Сповіщень для цієї заявки в API немає.</p>';
  }catch(e){if(generation===state.generation)$('notifications').innerHTML=`<p class="sectionError">Не вдалося завантажити сповіщення: ${esc(e.message)}. Натисніть «Оновити».</p>`;throw e;}
}
function valueText(value,key) {
  if(value===null||value===undefined)return '—';
  if(key==='status')return statuses[value]||value;
  if(key==='category')return state.boot.categories[value]||value;
  if(typeof value==='object'&&value.date)return date(value.date);
  return typeof value==='object'?JSON.stringify(value,null,2):String(value);
}
async function loadHistory(generation) {
  try {
    const d=await call({action:'history',...context(),page:state.historyPage});if(generation!==state.generation)return;
    state.history.push(...(d['hydra:member']||[]));state.historyError=null;
    $('history').innerHTML=`<div class="event"><small>${esc(date(state.order.createdAt))}</small><p>Заявку створено</p></div>`+state.history.map(h=>{
      const keys=[...new Set([...Object.keys(h.before||{}),...Object.keys(h.after||{})])];
      return `<div class="event"><small>${esc(date(h.createdAt))} · ${esc(person(h.createdBy))}</small>${keys.map(k=>`<p class="pre"><strong>${esc(fields[k]||k)}</strong>: ${esc(valueText(h.before?.[k],k))} → ${esc(valueText(h.after?.[k],k))}</p>`).join('')||`<p>${esc(h.type)}</p>`}</div>`;
    }).join('');
    $('moreHistory').hidden=!d['hydra:view']?.['hydra:next'];
  } catch(e) {if(generation===state.generation){state.historyError=e.message;$('history').innerHTML=`<p class="sectionError">Не вдалося завантажити історію: ${esc(e.message)}</p>`;}throw e;}
}
async function loadChat(generation) {
  try {
    const d=await call({action:'chat',...context(),page:state.chatPage});if(generation!==state.generation)return;
    state.messages.push(...(d.data||[]));state.chatError=null;
    const sorted=[...state.messages].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
    $('chat').innerHTML=sorted.map(m=>`<div class="message"><small>${esc(date(m.createdAt))}</small><p class="author">${esc(person(m.sender?.user))}</p><div class="pre">${esc(m.body||'')}</div>${m.medias?photos({files:Array.isArray(m.medias)?m.medias:[m.medias]}):''}${m.payload?`<details><summary>Додаткові дані</summary><pre class="raw">${esc(JSON.stringify(m.payload,null,2))}</pre></details>`:''}</div>`).join('')||'<p class="muted">Повідомлень у цій заявці ще немає.</p>';
    $('moreChat').hidden=state.chatPage>=(d.pageCount||1);
    const closed=['completed','canceled'].includes(state.order.status);
    $('messageForm').hidden=closed;
    if(closed)$('chat').insertAdjacentHTML('beforeend','<p class="muted">Заявку закрито; діалог доступний для читання.</p>');
  }catch(e){if(generation===state.generation){state.chatError=e.message;$('chat').innerHTML=`<p class="sectionError">Не вдалося завантажити діалог: ${esc(e.message)}</p>`;}throw e;}
}
async function allPages(action, selection) {
  const items=[];let page=1;
  while(true){const d=await call({action,...selection,page});items.push(...(action==='chat'?d.data||[]:d['hydra:member']||[]));if(action==='chat'?page>=(d.pageCount||1):!d['hydra:view']?.['hydra:next'])break;page++;if(page>1000)throw new Error('Забагато сторінок для експорту');}
  return items;
}
async function exportOrder() {
  const selection={...context()};const o=state.order;
  notice('Завантажую історію, діалог і сповіщення для повного зведення…');
  const [history,messages,notificationResult]=await Promise.all([allPages('history',selection),allPages('chat',selection),call({action:'notifications',...selection})]);
  const notifications=notificationResult.data||[];
  if(selection.id!==state.selected.id||selection.kind!==state.selected.kind)throw new Error('Вибір заявки змінився. Повторіть експорт.');
  const lines=[`DIM9000 — Заявка № ${o.id}`,`Збережено: ${date(new Date())}`,`Статус: ${statuses[o.status]||o.status}`,`Створено: ${date(o.createdAt)}`,`Термін: ${date(o.deadline)}`,`Об’єкт: ${address(o.space)||address(o)}`,'','ЗВЕРНЕННЯ',o.description||'','', 'ВІДПОВІДЬ',o.answer||'Відсутня',o.cancellationReason||'','', 'ОЦІНКА',o.review?JSON.stringify(o.review,null,2):'Відсутня','','СПОВІЩЕННЯ ТА ПОЯСНЕННЯ УК',...notifications.map(n=>`${date(n.createdAt)} · ${notificationTitle(n)}\n${n.newDeadline?'Новий термін: '+date(n.newDeadline)+'\n':''}${n.transition?.to?(statuses[n.transition.from]||n.transition.from||'—')+' → '+(statuses[n.transition.to]||n.transition.to)+'\n':''}${n.comment}`),'','ІСТОРІЯ',...history.map(h=>`${date(h.createdAt)} · ${person(h.createdBy)}\n${JSON.stringify(h.before)} → ${JSON.stringify(h.after)}`),'','ДІАЛОГ',...messages.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).map(m=>`${date(m.createdAt)} · ${person(m.sender?.user)}\n${m.body||''}`),'','ПОВНІ ДАНІ (посилання на медіа можуть мати обмежений строк дії)',JSON.stringify({order:o,history,messages,notifications},null,2)];
  const text=lines.join('\n');const link=$('exportLink');
  if(link.href.startsWith('blob:'))URL.revokeObjectURL(link.href);
  link.href=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));link.download=`dim9000-${selection.kind}-${o.id}.txt`;
  $('exportText').value=text;$('exportDialog').showModal();notice('Повне зведення сформовано.');
}
async function loadCatalog(){const d=await call({action:'catalog',space:$('createSpace').value});$('createService').innerHTML=options((d['hydra:member']||[]).map(x=>[x['@id'],`${x.name} · від ${x.minPrice} грн`]));}
async function newOrder(){
  const paid=$('kind').value==='paid-orders';state.createKind=$('kind').value;state.draftFiles=[];$('createForm').reset();$('draftFiles').textContent='';$('createError').textContent='';
  $('createSpace').value=$('space').value;$('categoryLabel').hidden=paid;$('serviceLabel').hidden=!paid;$('photosLabel').hidden=paid;$('createCategory').required=!paid;$('createService').required=paid;
  $('createType').textContent=paid?'Замовлення платної послуги':'Звернення до управляючої компанії';
  if(paid)await loadCatalog();$('createDialog').showModal();
}
async function upload(file){
  if(file.size>10*1024*1024)throw new Error('Файл завеликий: '+file.name);
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
  return call({action:'upload',name:file.name,mime:file.type,data});
}
$('filters').onsubmit=e=>{e.preventDefault();state.page=1;run(e.submitter,loadList);};
$('kind').onchange=()=>{$('category').disabled=$('kind').value!=='orders';state.page=1;run(null,loadList);};
$('prev').onclick=e=>{state.page--;run(e.currentTarget,loadList);};$('next').onclick=e=>{state.page++;run(e.currentTarget,loadList);};
$('new').onclick=e=>run(e.currentTarget,newOrder);$('closeCreate').onclick=()=>$('createDialog').close();
$('createSpace').onchange=()=>{if(state.createKind==='paid-orders')run(null,loadCatalog);};
$('createPhotos').onchange=()=>{state.draftFiles=[];$('draftFiles').textContent='';};
$('createForm').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
  try{
    $('createError').textContent='';const data=Object.fromEntries(new FormData(e.target));
    if(state.createKind==='orders'){
      delete data.name;const files=[...$('createPhotos').files];if(files.length>5)throw new Error('Дозволено до 5 фотографій.');
      for(let i=state.draftFiles.length;i<files.length;i++){state.draftFiles.push((await upload(files[i]))['@id']);$('draftFiles').textContent=`Завантажено фото: ${state.draftFiles.length} / ${files.length}`;}
      data.gallery={files:state.draftFiles};
    }else delete data.category;
    const result=await call({action:'create',kind:state.createKind,data});$('createDialog').close();state.page=1;await loadList();await openOrder(state.createKind,result.id);notice('Заявку створено.');
  }catch(err){$('createError').textContent=err.message;throw err;}
});};
$('sms').onclick=e=>run(e.currentTarget,async()=>{await request('/api/sms',{phone:$('loginForm').elements.phone.value.trim()});notice('SMS-код надіслано.');});
$('loginForm').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await request('/api/login',Object.fromEntries(new FormData(e.target)));e.target.elements.code.value='';await start();});};
$('logout').onclick=e=>run(e.currentTarget,async()=>{await request('/api/logout',{});location.reload();});
$('closeExport').onclick=()=>$('exportDialog').close();
run(null,start);
