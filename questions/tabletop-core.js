(() => {
  const initial = () => ({ play: 'shared', players: 2, turn: 0, cards: [null, null, null] });
  function act(state, remaining, total, action, slot = 0, value = null, random = Math.random) {
    const next = JSON.parse(JSON.stringify(state || initial()));
    let pool = [...remaining];
    if (action === 'configure') {
      if (!['shared','individual'].includes(value.play) || ![2,3].includes(value.players)) throw Error('玩法不正确');
      Object.assign(next, initial(), value);
    } else if (action === 'turn') next.turn = (next.turn + 1) % next.players;
    else if (action === 'reset') { next.cards = [null,null,null]; next.turn = 0; }
    else if (action === 'draw') {
      if (!Number.isInteger(slot) || slot < 0 || slot >= (next.play === 'shared' ? 1 : next.players)) throw Error('座位不正确');
      if (next.cards[slot] !== null) next.cards[slot] = null;
      else {
        const occupied = next.cards.filter(Number.isInteger);
        pool = pool.filter(i => !occupied.includes(i));
        if (!pool.length) pool = Array.from({length:total},(_,i)=>i).filter(i=>!occupied.includes(i));
        if (!pool.length) throw Error('题目不足，请先收回一张卡片。');
        const picked = pool[Math.floor(random() * pool.length)];
        next.cards[slot] = picked; pool = pool.filter(i=>i!==picked);
      }
    } else throw Error('操作不正确');
    return { table: next, remaining: pool };
  }
  const api = { initial, act };
  if (typeof module !== 'undefined') module.exports = api;
  else window.QuestionTable = api;
})();
