(() => {
 'use strict';
 const $=id=>document.getElementById(id), params=new URLSearchParams(location.search), preview=params.get('preview')==='1';
 const KEY='notion-question-cards-v1';
 const cloud=!preview && params.has('id') ? window.QuestionCloud.create(location.search) : null;
 let settings=window.QuestionPresentation.normalize(), table=window.QuestionTable.initial(), remaining=[], questions=preview?['这里会显示抽到的问题。','这里会显示另一张问题卡。','每个人会有自己的问题。']:window.QUESTION_CARDS;
 let revision=-1, ready=preview||!cloud, busy=false, poll, unsubscribe, motionTimer;
 const slots=new Map(), fields={frontTop:'封面上方',invitation:'封面标题',frontBottom:'封面下方',backTop:'问题上方',backBottom:'问题下方'};
 if(['light','dark'].includes(params.get('theme'))) document.documentElement.dataset.theme=params.get('theme');
 $('manage-questions').href='./dashboard.html'+(params.has('id')?'?id='+encodeURIComponent(params.get('id')):'');
 function status(text=''){ $('sync-status').textContent=text;$('sync-status').hidden=!text; }
 function saveLocal(){if(preview||cloud)return;try{const old=JSON.parse(localStorage.getItem(KEY))||{};localStorage.setItem(KEY,JSON.stringify({...old,table,tableSource:questions,remaining}));}catch{status('当前浏览器无法保存进度。');}}
 function localLoad(){try{const old=JSON.parse(localStorage.getItem(KEY))||{};settings=window.QuestionPresentation.normalize(old.settings);if(!preview){questions=old.questions?.length?old.questions:window.QUESTION_CARDS;table=JSON.stringify(old.tableSource)===JSON.stringify(questions)&&old.table?old.table:window.QuestionTable.initial();remaining=JSON.stringify(old.tableSource)===JSON.stringify(questions)&&Array.isArray(old.remaining)?old.remaining:questions.map((_,i)=>i);}}catch{remaining=questions.map((_,i)=>i);}}
 function editable(node,key){if(!preview)return;node.classList.add('preview-copy');node.dataset.placeholder=key==='name'?'名称':fields[key];node.setAttribute('role','textbox');node.setAttribute('aria-label','编辑'+node.dataset.placeholder);node.contentEditable='plaintext-only';
  function send(commit=false){if(!ready)return;const value=node.textContent.replace(/[\r\n]+/g,' ').slice(0,100);if(node.textContent!==value)node.textContent=value;settings[key]=value;window.parent.postMessage({type:'question-preview-edit',key,value,commit},location.origin);}
  node.addEventListener('input',e=>{if(!e.isComposing)send();});node.addEventListener('compositionend',()=>send());node.addEventListener('blur',()=>send(true));node.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();node.blur();}});
 }
 function copy(node,key){if(document.activeElement!==node)node.textContent=settings[key];}
 editable($('widget-name'),'name');
 function render(animate=false){
  copy($('widget-name'),'name');$('play-toggle').setAttribute('aria-checked',String(table.play==='individual'));for(const n of [2,3])$(''+(n===2?'two':'three')+'-players').setAttribute('aria-pressed',String(table.players===n));
  $('seats').replaceChildren(...Array.from({length:table.players},(_,i)=>{const el=document.createElement('span');el.className='seat'+(table.turn===i?' active':'');el.textContent='玩家 '+(i+1);return el;}));
  const count=table.play==='shared'?1:table.players;const root=$('table-cards');root.classList.toggle('shared',count===1);root.style.setProperty('--slots',count);
  for(const [i,row]of slots)if(i>=count){row.el.remove();slots.delete(i);}
  for(let i=0;i<count;i++){
   let row=slots.get(i);if(!row){const el=document.createElement('article');el.className='table-slot';el.innerHTML='<p class="slot-label"></p><div class="table-card"><div class="table-face table-front"><div class="table-copy-small" data-copy="frontTop"></div><div class="table-content"><div class="deck-art" aria-hidden="true"><span></span><span></span><span>?</span></div><h1 data-copy="invitation"></h1></div><div class="table-copy-small" data-copy="frontBottom"></div></div><div class="table-face table-back"><div class="table-copy-small" data-copy="backTop"></div><div class="table-content"><span class="sample-label"></span><h1 class="drawn-question"></h1></div><div class="table-copy-small" data-copy="backBottom"></div></div></div><button class="table-hit" type="button"></button>';
    root.append(el);row={el,card:el.querySelector('.table-card'),hit:el.querySelector('button')};slots.set(i,row);row.hit.addEventListener('click',()=>act('draw',i));el.querySelectorAll('[data-copy]').forEach(n=>editable(n,n.dataset.copy));if(preview)el.querySelectorAll('.table-content').forEach(n=>n.addEventListener('click',e=>{if(!e.target.closest('.preview-copy'))void act('draw',i);}));
   }
   const index=table.cards[i],open=Number.isInteger(index)&&index>=0&&index<questions.length;
   row.el.classList.toggle('active',table.play==='individual'&&table.turn===i);row.el.querySelector('.slot-label').textContent=count===1?'一起回答':'玩家 '+(i+1);
   const instant=!animate&&row.card.classList.contains('open')!==open;if(instant)row.card.classList.add('instant');row.card.classList.toggle('open',open);if(instant){void row.card.offsetWidth;row.card.classList.remove('instant');}
   row.el.querySelector('.table-front').setAttribute('aria-hidden',String(open));row.el.querySelector('.table-back').setAttribute('aria-hidden',String(!open));
   // Keep the outgoing question on its back until the next reveal, so closing never flashes blank.
   if(open)row.el.querySelector('.drawn-question').textContent=questions[index];
   row.el.querySelector('.sample-label').textContent=preview?'示例问题':'';
   row.el.querySelectorAll('[data-copy]').forEach(n=>{copy(n,n.dataset.copy);if(preview){const visible=n.closest('.table-back')?open:!open;n.contentEditable=visible&&ready?'plaintext-only':'false';n.tabIndex=visible&&ready?0:-1;}});
   row.hit.setAttribute('aria-label',open?'收回这张卡片':'抽取问题卡');row.hit.disabled=busy||!ready;
  }
  for(const id of ['play-toggle','two-players','three-players','next-turn','reset-table'])$(id).disabled=busy||!ready;
 }
 function accept(deck,animate){if(deck.revision<revision)return;const changed=JSON.stringify(table)!==JSON.stringify(deck.table);questions=deck.questions;remaining=deck.remaining;table=deck.table||window.QuestionTable.initial();settings=window.QuestionPresentation.normalize(deck.settings);revision=deck.revision;ready=true;render(animate&&changed);}
 async function load(animate=false){if(busy)return;try{accept(await cloud.load(),animate);status();}catch(e){ready=false;status(e.message);render();}}
 async function act(action,slot=0,value=null){if(busy||!ready)return;busy=true;render();try{
   if(cloud){const result=await cloud.tableChange(action,revision,slot,value);accept(result.deck,true);if(result.status==='conflict')status('其他设备刚更新了卡桌，请再点一次。');else status();}
   else{const result=window.QuestionTable.act(table,remaining,questions.length,action,slot,value);table=result.table;remaining=result.remaining;saveLocal();render(true);status();}
   if(action==='draw'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){clearTimeout(motionTimer);motionTimer=setTimeout(()=>{busy=false;render(true);},600);return;}
  }catch(e){status(e.message);if(cloud&&!e.message.includes('题目不足'))ready=false;}busy=false;render(true);}
 $('play-toggle').addEventListener('click',()=>act('configure',0,{play:table.play==='shared'?'individual':'shared',players:table.players}));
 for(const n of [2,3])$(n===2?'two-players':'three-players').addEventListener('click',()=>{if(n!==table.players)void act('configure',0,{play:table.play,players:n});});
 $('next-turn').addEventListener('click',()=>act('turn'));$('reset-table').addEventListener('click',()=>act('reset'));
 if(preview){document.documentElement.classList.add('table-preview');$('preview-heading').hidden=false;$('manage-questions').hidden=true;remaining=questions.map((_,i)=>i);
  window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='question-preview')return;settings=window.QuestionPresentation.normalize(e.data.settings);ready=e.data.ready===true;render(true);});
  if(window.ResizeObserver)new ResizeObserver(()=>{window.parent.postMessage({type:'question-preview-size',height:Math.max(320,Math.min(1200,Math.ceil(document.querySelector('main').getBoundingClientRect().height))),cardTop:$('table-cards').getBoundingClientRect().top+window.scrollY},location.origin);}).observe(document.querySelector('main'));
 }else if(cloud){void load();unsubscribe=cloud.subscribe(()=>void load(true),()=>{});poll=setInterval(()=>{if(!document.hidden)void load(true);},5000);window.addEventListener('focus',()=>void load());window.addEventListener('beforeunload',()=>{unsubscribe?.();clearInterval(poll);});}
 else{localLoad();window.addEventListener('storage',e=>{if(e.key===KEY){localLoad();render(true);}});}
 render();
})();
