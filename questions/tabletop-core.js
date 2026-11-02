(() => {
 const initial=()=>({play:'single',card:null,history:[],last:null});
 function normalize(state,total){
  const valid=i=>Number.isInteger(i)&&i>=0&&i<total;
  if(!state)return initial();
  const legacy=Array.isArray(state.cards)?state.cards.filter(valid):[];
  const play=['multiple','individual'].includes(state.play)?'multiple':'single';
  const card=valid(state.card)?state.card:!('card' in state)?legacy[0]??null:null;
  return {play,card,history:play==='multiple'?[...new Set((Array.isArray(state.history)?state.history:legacy).filter(valid))]:[],last:valid(state.last)?state.last:card};
 }
 function act(state,remaining,total,action,slot=0,value=null,random=Math.random){
  const next=normalize(state,total);let pool=[...new Set(remaining.filter(i=>Number.isInteger(i)&&i>=0&&i<total))];
  if(action==='configure'){
   if(!['single','multiple'].includes(value?.play))throw Error('抽牌方式不正确');
   Object.assign(next,initial(),{play:value.play,last:next.last});
  }else if(action==='draw'){
   if(next.card!==null)next.card=null;
   else{
    const fresh=!pool.length;if(fresh){pool=Array.from({length:total},(_,i)=>i);next.history=[];}
    if(!pool.length)throw Error('题库中没有问题。');
    const choices=fresh&&pool.length>1?pool.filter(i=>i!==next.last):pool;
    const picked=choices[Math.floor(random()*choices.length)];next.card=picked;next.last=picked;
    pool=pool.filter(i=>i!==picked);if(next.play==='multiple')next.history.push(picked);
   }
  }else throw Error('操作不正确');
  return {table:next,remaining:pool};
 }
 const api={initial,normalize,act};if(typeof module!=='undefined')module.exports=api;else window.QuestionTable=api;
})();
