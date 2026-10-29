const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('questions/app.js', 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
function setup({ questions=['甲','乙','丙'], stored=null, search='', reduced=false, blocked=false, service=null }={}) {
  const nodes=new Map(); const timers=new Map(); let timerId=0; const events={}; let persisted=stored;
  function el(id) {
    if(!nodes.has(id)) { const classes=new Set(); nodes.set(id,{ hidden:false,disabled:false,textContent:'',value:'',dataset:{},handlers:{},offsetWidth:100,
      addEventListener(type,fn){this.handlers[type]=fn;},setAttribute(k,v){this[k]=v;},
      classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)} }); }
    return nodes.get(id);
  }
  const radios=[el('mode-card'),el('mode-box')];radios[0].value='card';radios[1].value='box';
  vm.runInNewContext(source,{window:{QUESTION_CARDS:questions,QuestionCloud:service?{create:()=>service}:null,addEventListener:(type,fn)=>{events[type]=fn;}},
    document:{hidden:false,documentElement:el('root'),getElementById:el,querySelectorAll:()=>radios,querySelector:()=>el('scene'),addEventListener(){}},
    location:{search},URLSearchParams,localStorage:{getItem(){if(blocked)throw Error('blocked');return persisted;},setItem(k,v){if(blocked)throw Error('blocked');persisted=v;}},
    matchMedia:()=>({matches:reduced}),setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval(){return 1;},clearInterval(){},Date});
  return {el,fire:(id,type='click')=>el(id).handlers[type](),flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}},saved:()=>JSON.parse(persisted),snapshot:()=>persisted};
}
function server() {
  let deck={questions:['云甲','云乙','云丙'],remaining:[0,1,2],current:null,revealed:false,revision:0};
  let fail=false;const listeners=[];
  return {fail:()=>{fail=true;},deck:()=>clone(deck),service:{
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
test('management uses the same deck in a separate dashboard URL',()=>{
  const p=setup({search:'?id=shared&theme=dark',service:server().service});assert.equal(p.el('manage-questions').href,'./dashboard.html?id=shared&theme=dark');assert.equal(p.el('root').dataset.theme,'dark');
});
test('two online clients show the same question and animate both sides of a flip',async()=>{
  const s=server();const a=setup({search:'?id=shared',service:s.service});const b=setup({search:'?id=shared',service:s.service});await tick();
  await a.fire('card-action');await tick();
  assert.equal(a.el('question-text').textContent,b.el('question-text').textContent);assert.equal(a.el('card').classList.contains('is-revealed'),true);assert.equal(b.el('card').classList.contains('is-revealed'),true);
  assert.equal(a.el('card-action').disabled,true);assert.equal(b.el('card-action').disabled,true);
  a.flush();b.flush();await b.fire('card-action');await tick();assert.equal(a.el('card').classList.contains('is-revealed'),false);assert.equal(b.el('card').classList.contains('is-revealed'),false);
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
