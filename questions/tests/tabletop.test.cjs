const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initial,act}=require('../tabletop-core.js');
test('shared draw keeps one question while turn advances',()=>{let a=act(initial(),[0,1,2],3,'draw',0,null,()=>0);const b=act(a.table,a.remaining,3,'turn');assert.deepEqual(b.table.cards,[0,null,null]);assert.equal(b.table.turn,1);});
test('three people draw distinct cards even across pool refill',()=>{let a=act(initial(),[],3,'configure',0,{play:'individual',players:3});for(let i=0;i<3;i++)a=act(a.table,a.remaining,3,'draw',i,null,()=>0);assert.equal(new Set(a.table.cards).size,3);});
test('clicking an open card closes it before another draw',()=>{let a=act(initial(),[0,1],2,'draw',0,null,()=>0);a=act(a.table,a.remaining,2,'draw');assert.equal(a.table.cards[0],null);assert.deepEqual(a.remaining,[1]);a=act(a.table,a.remaining,2,'draw',0,null,()=>0);assert.equal(a.table.cards[0],1);});
test('not enough questions never assigns a duplicate live card',()=>{let a=act(initial(),[0],1,'configure',0,{play:'individual',players:2});a=act(a.table,a.remaining,1,'draw');assert.throws(()=>act(a.table,a.remaining,1,'draw',1),/题目不足/);});
test('reset returns all cards and resets the answering order',()=>{const state={play:'individual',players:3,turn:2,cards:[0,1,2]};const a=act(state,[],3,'reset');assert.deepEqual(a.table.cards,[null,null,null]);assert.equal(a.table.turn,0);assert.deepEqual(state.cards,[0,1,2]);});
test('invalid seats and configurations are rejected',()=>{assert.throws(()=>act(initial(),[0],1,'draw',2));assert.throws(()=>act(initial(),[0],1,'configure',0,{play:'individual',players:4}));});
