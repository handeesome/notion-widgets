const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('questions/presentation.js','utf8')+'\n'+fs.readFileSync('questions/dashboard.js','utf8');
const tick=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
function setup({service=null}={}) {
  const nodes=new Map();const timers=new Map();let timerID=0;
  const node=()=>({children:[],handlers:{},style:{},scrollHeight:71,value:'',textContent:'',hidden:false,disabled:false,focus(){},append(...items){for(const item of items){this.children.push(item);item.parent=this;}},remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);},addEventListener(t,f){this.handlers[t]=f;},setAttribute(k,v){this[k]=v;}});
  const el=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  let stored=JSON.stringify({questions:['旧问题'],questionMeta:[{id:'old-id',created_at:'2020-01-01T00:00:00.000Z'}],mode:'box'});
  vm.runInNewContext(source,{window:{QUESTION_CARDS:['示例问题'],QuestionCloud:service?{create:()=>service}:null,addEventListener(){}},document:{hidden:false,activeElement:null,documentElement:{dataset:{}},getElementById:el,createElement:node},location:{search:service?'?id=cloud':''},URLSearchParams,Date,Intl,crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>stored,setItem:(k,v)=>{stored=v;}},setTimeout(fn){const id=++timerID;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval(){return 1;},clearInterval(){}});
  return{el,rows:()=>el('question-rows').children,fire:(id,type='click')=>el(id).handlers[type](),flush(){for(const[id,fn]of[...timers]){timers.delete(id);fn();}},saved:()=>JSON.parse(stored)};
}
test('the eye reveals read-only text and editing requires a separate button',async()=>{
  const page=setup();await tick();const row=page.rows()[0];const input=row.children[2];const eye=row.children[0].children[1].children[0];
  assert.equal(input.hidden,true);assert.equal(input.value,'');assert.equal(row.children[1].textContent,'***');
  const edit=row.children[0].children[1].children[1];
  eye.handlers.click();assert.equal(row.children[1].textContent,'旧问题');assert.equal(input.hidden,true);assert.equal(input.disabled,true);assert.equal(edit.hidden,false);assert.equal(row.children[3].dateTime,'2020-01-01T00:00:00.000Z');
  edit.handlers.click();assert.equal(input.value,'旧问题');assert.equal(input.hidden,false);assert.equal(input.disabled,false);assert.equal(edit.textContent,'完成');
  edit.handlers.click();assert.equal(input.hidden,true);assert.equal(row.children[1].textContent,'旧问题');assert.equal(edit.textContent,'修改');
  eye.handlers.click();assert.equal(input.value,'');assert.equal(input.hidden,true);
  assert.equal(edit.hidden,true);assert.deepEqual(page.saved().questions,['旧问题']);
});
test('adding persists immediately and records a timestamp without a save button',async()=>{
  const page=setup();await tick();page.el('new-questions').value='新的讨论问题';await page.fire('add');
  const saved=page.saved();assert.deepEqual(saved.questions,['旧问题','新的讨论问题']);assert.ok(Number.isFinite(Date.parse(saved.questionMeta[1].created_at)));assert.equal(page.el('new-questions').value,'');
});
test('editing auto-saves while keeping the original creation time and focused row node',async()=>{
  const page=setup();await tick();const row=page.rows()[0];row.children[0].children[1].children[0].handlers.click();row.children[0].children[1].children[1].handlers.click();row.children[2].value='修改旧问题';row.children[2].handlers.input();page.flush();await tick();
  assert.deepEqual(page.saved().questions,['修改旧问题']);assert.equal(page.saved().questionMeta[0].created_at,'2020-01-01T00:00:00.000Z');assert.equal(page.rows()[0],row);
});
test('removing persists immediately, while removal of the final question is rejected',async()=>{
  const page=setup();await tick();page.el('new-questions').value='第二个问题';await page.fire('add');page.rows()[1].children[0].children[1].children[2].handlers.click();await tick();assert.deepEqual(page.saved().questions,['旧问题']);
  page.rows()[0].children[0].children[1].children[2].handlers.click();await tick();assert.deepEqual(page.saved().questions,['旧问题']);assert.equal(page.el('retry').hidden,false);
});
test('a cloud add merges with a concurrent addition and retries a version conflict',async()=>{
  let deck={revision:0,items:[{id:'one',text:'原问题',created_at:'2020-01-01T00:00:00Z'}]};let writes=0;
  const service={load:async()=>JSON.parse(JSON.stringify(deck)),subscribe(){return()=>{};},async change(action,version,{questions}){writes++;if(writes===1){deck={revision:1,items:[...deck.items,{id:'two',text:'另一台新增',created_at:'2020-02-01T00:00:00Z'}]};return{status:'conflict',deck:JSON.parse(JSON.stringify(deck))};}deck={revision:2,items:questions.map((q,i)=>({...q,id:q.id||'three',created_at:'2020-01-01T00:00:00Z'}))};return{status:'ok',deck};}};
  const page=setup({service});await tick();page.el('new-questions').value='本机新增';await page.fire('add');assert.deepEqual(deck.items.map(q=>q.text),['原问题','另一台新增','本机新增']);assert.equal(writes,2);
});
test('an edit conflict preserves local input and requires explicit retry before overwriting',async()=>{
  let deck={revision:0,items:[{id:'one',text:'原问题',created_at:'2020-01-01T00:00:00Z'}]};
  const service={load:async()=>JSON.parse(JSON.stringify(deck)),subscribe(){return()=>{};},async change(action,version,{questions}){deck={revision:deck.revision+1,items:questions.map(q=>({...q,created_at:'2020-01-01T00:00:00Z'}))};return{status:'ok',deck};}};
  const page=setup({service});await tick();const row=page.rows()[0];row.children[0].children[1].children[0].handlers.click();row.children[0].children[1].children[1].handlers.click();row.children[2].value='本机草稿';row.children[2].handlers.input();deck.items[0].text='别人修改';deck.revision++;page.flush();await tick();
  assert.equal(deck.items[0].text,'别人修改');assert.equal(row.children[2].value,'本机草稿');assert.equal(page.el('retry').hidden,false);await page.fire('retry');assert.equal(deck.items[0].text,'本机草稿');
});

test('finishing editing saves a pending draft and returns to read-only paper text',async()=>{
  const page=setup();await tick();const row=page.rows()[0];const controls=row.children[0].children[1].children;
  controls[0].handlers.click();controls[1].handlers.click();row.children[2].value='刚修改的问题';row.children[2].handlers.input();controls[1].handlers.click();await tick();
  assert.equal(row.children[2].hidden,true);assert.equal(row.children[1].textContent,'刚修改的问题');assert.deepEqual(page.saved().questions,['刚修改的问题']);
});

test('home copy auto-saves separately from the question list and survives later additions',async()=>{
  const page=setup();await tick();const input=page.el('copy-fields').children[2].children[0];input.value='今天想聊些什么？';input.handlers.input();page.flush();await tick();
  assert.equal(page.saved().settings.invitation,'今天想聊些什么？');assert.deepEqual(page.saved().questions,['旧问题']);
  page.el('new-questions').value='新问题';await page.fire('add');assert.equal(page.saved().settings.invitation,'今天想聊些什么？');
});

test('cloud settings merge other fields and preserve question progress',async()=>{
  let deck={revision:3,settings:{name:'原名称'},current:0,revealed:true,remaining:[],items:[{id:'one',text:'原问题',created_at:'2020-01-01T00:00:00Z'}]};let writes=0;
  const service={load:async()=>JSON.parse(JSON.stringify(deck)),subscribe(){return()=>{};},async updateSettings(revision,settings){assert.equal(revision,deck.revision);writes++;if(writes===1){deck.settings.frontTop='别处的改动';deck.revision++;return{status:'conflict',deck};}deck={...deck,revision:deck.revision+1,settings:{...deck.settings,...settings}};return{status:'ok',deck};}};
  const page=setup({service});await tick();const input=page.el('copy-fields').children[0].children[0];input.value='新的名称';input.handlers.input();page.flush();await tick();
  assert.equal(deck.settings.name,'新的名称');assert.equal(deck.settings.frontTop,'别处的改动');assert.equal(deck.current,0);assert.equal(deck.revealed,true);assert.equal(writes,2);
});
