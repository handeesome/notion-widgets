const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('questions/dashboard.js','utf8');
function setup() {
  const nodes=new Map();
  const node=()=>({children:[],handlers:{},value:'',textContent:'',hidden:false,disabled:false,append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(t,f){this.handlers[t]=f;},setAttribute(k,v){this[k]=v;}});
  const el=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  let stored=JSON.stringify({questions:['旧问题'],questionMeta:[{id:'old-id',created_at:'2020-01-01T00:00:00.000Z'}],mode:'box'});
  vm.runInNewContext(source,{window:{QUESTION_CARDS:['示例问题'],addEventListener(){}},document:{documentElement:{dataset:{}},getElementById:el,createElement:node},location:{search:''},URLSearchParams,Date,Intl,crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>stored,setItem:(k,v)=>{stored=v;}}});
  return{el,rows:()=>el('question-rows').children,fire:(id)=>el(id).handlers.click(),saved:()=>JSON.parse(stored),setStored:value=>{stored=JSON.stringify(value);}};
}
test('each row hides its original text and only its own eye reveals it',()=>{
  const page=setup();const row=page.rows()[0];const input=row.children[2];const eye=row.children[0].children[1].children[0];
  assert.equal(input.hidden,true);assert.equal(input.value,'');assert.equal(row.children[1].textContent,'***');
  eye.handlers.click();assert.equal(input.value,'旧问题');assert.equal(input.hidden,false);assert.equal(row.children[3].dateTime,'2020-01-01T00:00:00.000Z');
  eye.handlers.click();assert.equal(input.value,'');assert.equal(input.hidden,true);
});
test('saving preserves existing creation dates and timestamps only newly added questions',async()=>{
  const page=setup();page.el('new-questions').value='新的讨论问题';page.fire('add');
  const row=page.rows()[0];row.children[0].children[1].children[0].handlers.click();row.children[2].value='修改旧问题';row.children[2].handlers.input();
  await page.fire('save');const saved=page.saved();assert.deepEqual(saved.questions,['修改旧问题','新的讨论问题']);assert.equal(saved.questionMeta[0].created_at,'2020-01-01T00:00:00.000Z');assert.ok(Number.isFinite(Date.parse(saved.questionMeta[1].created_at)));assert.equal(saved.current,null);assert.equal(page.rows()[0].children[2].hidden,true);
});
test('a second dashboard cannot overwrite a changed question list with stale drafts',async()=>{
  const page=setup();page.el('new-questions').value='草稿问题';page.fire('add');page.setStored({questions:['另一页修改的问题']});await page.fire('save');assert.match(page.el('status').textContent,/另一个页面/);assert.deepEqual(page.saved().questions,['另一页修改的问题']);assert.equal(page.rows().length,2);
});
