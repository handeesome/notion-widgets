const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('questions/presentation.js', 'utf8') + '\n' + fs.readFileSync('questions/app.js', 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
function setup({ questions=['甲','乙','丙'], stored=null, search='', reduced=false, blocked=false, service=null }={}) {
  const nodes=new Map(); const timers=new Map(); let timerId=0; const events={}; let persisted=stored;
  const messages=[];const parent={postMessage:(value)=>messages.push(clone(value))};
  function el(id) {
    if(!nodes.has(id)) { const classes=new Set(); nodes.set(id,{ hidden:false,disabled:false,textContent:'',value:'',dataset:{},handlers:{},offsetWidth:100,
      addEventListener(type,fn){this.handlers[type]=fn;},setAttribute(k,v){this[k]=v;},
      classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)} }); }
    return nodes.get(id);
  }
  const document={hidden:false,activeElement:null,documentElement:el('root'),getElementById:el,querySelector:()=>el('scene'),addEventListener(){}};
  vm.runInNewContext(source,{window:{parent,QUESTION_CARDS:questions,QuestionCloud:service?{create:()=>service}:null,addEventListener:(type,fn)=>{events[type]=fn;}},
    document,
    location:{search,origin:'https://widgets.test'},URLSearchParams,localStorage:{getItem(){if(blocked)throw Error('blocked');return persisted;},setItem(k,v){if(blocked)throw Error('blocked');persisted=v;}},
    matchMedia:()=>({matches:reduced}),setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval(){return 1;},clearInterval(){},Date});
  return {el,events,messages,document,receive:(data)=>events.message({origin:'https://widgets.test',source:parent,data}),fire:(id,type='click',event)=>el(id).handlers[type](event),step(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();},flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}},saved:()=>JSON.parse(persisted),snapshot:()=>persisted};
}
function server() {
  let deck={questions:['云甲','云乙','云丙'],remaining:[0,1,2],current:null,revealed:false,revision:0};
  let fail=false;const listeners=[];
  return {fail:()=>{fail=true;},settings(value){deck.settings=value;deck.last_action='settings';deck.revision++;listeners.forEach(fn=>fn());},deck:()=>clone(deck),service:{
    async load(){if(fail)throw Error('连接中断');return clone(deck);},
    async change(action,rev,{reveal=false}={}){if(fail)throw Error('连接中断');if(rev!==deck.revision)return {status:'conflict',deck:clone(deck)};
      if(action==='draw'){if(!deck.remaining.length)deck.remaining=[0,1,2].filter(i=>i!==deck.current);deck.current=deck.remaining.shift();deck.revealed=reveal;} else deck.revealed=true;
      deck.revision++;listeners.forEach(fn=>fn());return {status:'ok',deck:clone(deck)};
    },subscribe(fn,status){listeners.push(fn);status(true);return()=>{};}
  }};
}
test('click opens a question, next click returns a sealed box, then opens that question',()=>{
  const p=setup();p.fire('card-action');assert.equal(p.saved().revealed,true);assert.equal(p.saved().remaining.length,2);
  assert.equal(p.el('card-action').disabled,true);p.flush();p.fire('card-action');
  assert.equal(p.saved().revealed,false);const index=p.saved().current;p.flush();p.fire('card-action');assert.equal(p.saved().current,index);assert.equal(p.saved().revealed,true);
});
test('unopened boxes survive refresh and cannot auto-open',()=>{
  const p=setup({reduced:true});p.fire('card-action');p.fire('card-action');const restored=setup({stored:p.snapshot()});
  assert.equal(restored.el('card').classList.contains('is-revealed'),false);assert.equal(restored.snapshot(),p.snapshot());
  restored.fire('card-action');assert.equal(restored.saved().current,p.saved().current);
});
test('rounds do not repeat questions and avoid immediate repeats at the boundary',()=>{
  const p=setup({reduced:true});const seen=[];p.fire('card-action');seen.push(p.saved().current);
  for(let i=0;i<2;i++){p.fire('card-action');p.fire('card-action');seen.push(p.saved().current);}
  assert.equal(new Set(seen).size,3);p.fire('card-action');assert.notEqual(p.saved().current,seen[2]);
});
test('blocked storage and empty decks do not break rendering',()=>{
  const p=setup({blocked:true,reduced:true});p.fire('card-action');assert.ok(p.el('question-text').textContent);assert.equal(p.el('storage-note').hidden,false);
  assert.equal(setup({questions:[]}).el('card-action').disabled,true);
});

test('home copy and default appearance load from settings while URL overrides remain effective',()=>{
  const stored=JSON.stringify({settings:{name:'我们的对话',invitation:'今天聊什么？',frontBottom:'慢慢想',mode:'card',theme:'dark'}});
  const p=setup({stored});assert.equal(p.el('widget-name').textContent,'我们的对话');assert.equal(p.el('invitation-title').textContent,'今天聊什么？');assert.equal(p.el('root').dataset.mode,'card');assert.equal(p.el('root').dataset.theme,'auto');
  const q=setup({stored,search:'?mode=box&theme=light'});assert.equal(q.el('root').dataset.mode,'box');assert.equal(q.el('root').dataset.theme,'light');
});

test('preview uses only a placeholder and never reads or writes cloud questions or local progress',async()=>{
  let writes=0;let reads=0;const service={async load(){reads++;throw Error('preview read questions');},async change(){writes++;throw Error('preview wrote to cloud');},subscribe(){return()=>{};}};
  const p=setup({service,search:'?id=shared&preview=1',reduced:true});await tick();assert.equal(p.el('card').classList.contains('is-revealed'),false);await p.fire('card-action');assert.equal(p.el('question-text').textContent,'这里会显示抽到的问题。');assert.equal(writes,0);assert.equal(reads,0);assert.equal(p.snapshot(),null);assert.equal(p.el('preview-label').hidden,false);
  const q=setup({search:'?preview=1',reduced:true});q.fire('card-action');assert.equal(q.snapshot(),null);assert.equal(q.el('manage-questions').hidden,true);
});

test('a parent settings update does not close an already opened preview',()=>{
  const p=setup({search:'?preview=1',reduced:true});p.fire('card-action');p.receive({type:'question-preview',ready:true,settings:{backBottom:'慢慢聊'}});
  assert.equal(p.el('card').classList.contains('is-revealed'),true);assert.equal(p.el('card-note').textContent,'慢慢聊');
});

test('preview toggle sends the selected default and inline typing keeps the caret node intact',()=>{
  const p=setup({search:'?preview=1',reduced:true});p.receive({type:'question-preview',ready:true,settings:{mode:'box'}});p.fire('mode-toggle');assert.deepEqual(p.messages.at(-1),{type:'question-preview-edit',key:'mode',value:'card',commit:true});
  const text=p.el('invitation-title');p.document.activeElement=text;text.textContent='新文案';text.handlers.input({isComposing:false});assert.deepEqual(p.messages.at(-1),{type:'question-preview-edit',key:'invitation',value:'新文案',commit:false});
  p.receive({type:'question-preview',ready:true,settings:{invitation:'旧响应',mode:'card'}});assert.equal(text.textContent,'新文案');assert.equal(text.contentEditable,'plaintext-only');text.handlers.blur();assert.equal(p.messages.at(-1).commit,true);assert.equal(p.snapshot(),null);
  p.document.activeElement=null;p.fire('card-action');assert.equal(text.tabIndex,-1);assert.equal(text.contentEditable,'false');assert.equal(p.el('back-top').tabIndex,0);
});

test('preview center clicks animate while clicks on editable copy remain editing only',()=>{
  const p=setup({search:'?preview=1'});p.receive({type:'question-preview',ready:true,settings:{mode:'box'}});
  p.fire('invitation-content','click',{target:{closest:()=>p.el('invitation-title')}});assert.equal(p.el('card').classList.contains('box-opening'),false);
  const event={target:{closest:()=>null}};p.fire('invitation-content','click',event);assert.equal(p.el('card').classList.contains('box-opening'),true);p.flush();
  p.fire('question-content','click',event);assert.equal(p.el('card').classList.contains('box-resetting'),true);
  p.receive({type:'question-preview',ready:true,settings:{mode:'box',backBottom:'慢慢聊'}});assert.equal(p.el('card').classList.contains('box-resetting'),true);assert.equal(p.el('card-action').disabled,true);
  p.events.storage({key:'notion-question-cards-v1'});assert.equal(p.el('card').classList.contains('box-resetting'),true);
  p.flush();assert.equal(p.el('card').classList.contains('is-revealed'),false);assert.equal(p.el('card-action').disabled,false);assert.equal(p.snapshot(),null);
});

test('returning to a sealed box keeps the old question during exit and blocks duplicate draws',()=>{
  const p=setup();p.fire('card-action');p.flush();const text=p.el('question-text').textContent;p.fire('card-action');const snapshot=p.snapshot();
  assert.equal(p.el('card').classList.contains('box-resetting'),true);assert.equal(p.el('question-text').textContent,text);assert.equal(p.el('card-action').disabled,true);p.fire('card-action');assert.equal(p.snapshot(),snapshot);
  p.step();assert.equal(p.el('card').classList.contains('is-revealed'),false);assert.equal(p.el('question-text').textContent,'');assert.equal(p.el('card-action').disabled,true);
  p.step();assert.equal(p.el('card').classList.contains('box-resetting'),false);assert.equal(p.el('card-action').disabled,false);assert.equal(p.saved().revealed,false);
});

test('home toggle uses one switch and preserves the shared deck state',()=>{
  const p=setup({reduced:true});p.fire('card-action');const before=p.saved();p.fire('mode-toggle');assert.equal(p.el('mode-toggle')['aria-checked'],'false');assert.equal(p.el('root').dataset.mode,'card');assert.equal(p.saved().current,before.current);assert.equal(p.saved().revealed,before.revealed);
});
test('management uses the same deck in a separate dashboard URL',()=>{
  const p=setup({search:'?id=shared&theme=dark',service:server().service});assert.equal(p.el('manage-questions').href,'./dashboard.html?id=shared&theme=dark');assert.equal(p.el('root').dataset.theme,'dark');
});
test('two online card clients show the same question and animate both sides of a flip',async()=>{
  const s=server();const a=setup({search:'?id=shared&mode=card',service:s.service});const b=setup({search:'?id=shared&mode=card',service:s.service});await tick();
  await a.fire('card-action');await tick();
  assert.equal(a.el('question-text').textContent,b.el('question-text').textContent);assert.equal(a.el('card').classList.contains('is-revealed'),true);assert.equal(b.el('card').classList.contains('is-revealed'),true);
  assert.equal(a.el('card-action').disabled,true);assert.equal(b.el('card-action').disabled,true);
  a.flush();b.flush();await b.fire('card-action');await tick();assert.equal(a.el('card').classList.contains('is-revealed'),false);assert.equal(b.el('card').classList.contains('is-revealed'),false);
});
test('box mode opens the lid before showing the question, without flipping the card',async()=>{
  const s=server();const a=setup({search:'?id=shared',service:s.service});const b=setup({search:'?id=shared',service:s.service});await tick();
  await a.fire('card-action');await tick();
  assert.equal(a.el('card').classList.contains('box-opening'),true);assert.equal(b.el('card').classList.contains('box-opening'),true);
  assert.equal(a.el('card').classList.contains('is-revealed'),false);assert.equal(a.el('question-text').textContent,'');
  a.flush();b.flush();assert.equal(a.el('card').classList.contains('is-revealed'),true);assert.equal(a.el('question-text').textContent,b.el('question-text').textContent);
  await a.fire('card-action');await tick();assert.equal(a.el('card').classList.contains('box-resetting'),true);assert.equal(b.el('card').classList.contains('box-resetting'),true);
  s.settings({backBottom:'慢慢聊'});await tick();assert.equal(a.el('card').classList.contains('box-resetting'),true);assert.equal(b.el('card').classList.contains('box-resetting'),true);
  a.flush();b.flush();assert.equal(a.el('card').classList.contains('is-revealed'),false);assert.equal(b.el('card').classList.contains('is-revealed'),false);
});
test('a late arriving device restores a result without replaying its animation',async()=>{
  const s=server();const a=setup({search:'?id=shared',service:s.service});await tick();await a.fire('card-action');await tick();
  const b=setup({search:'?id=shared',service:s.service});await tick();assert.equal(b.el('card').classList.contains('is-revealed'),true);assert.equal(b.el('card-action').disabled,false);
});
test('simultaneous actions reject a stale revision and never double-draw',async()=>{
  const s=server();const a=setup({search:'?id=shared',service:s.service});const b=setup({search:'?id=shared',service:s.service});await tick();
  await Promise.all([a.fire('card-action'),b.fire('card-action')]);await tick();assert.equal(s.deck().revision,1);assert.equal(s.deck().remaining.length,2);
});
test('connection failure disables shared writes instead of falling back to local state',async()=>{
  const s=server();const p=setup({search:'?id=shared',service:s.service});await tick();s.fail();await p.fire('card-action');assert.equal(p.el('card-action').disabled,true);assert.match(p.el('sync-status').textContent,/连接中断/);assert.equal(p.snapshot(),null);
});
