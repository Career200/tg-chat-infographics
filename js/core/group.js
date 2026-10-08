/* Group-chat analysis (no DOM). Needs core/common.js. */
const SESSION_GAP = 3 * 3600;   // a pause longer than this inside one topic starts a new conversation
const MEME_KINDS = new Set(['photo','video','gif']);
const IGNITE_MIN = 3;           // a conversation "took off" when at least this many people wrote in it

function inspectGroup(data){
  if(data && data.chats && Array.isArray(data.chats.list)) throw new ChatError('full');
  if(!data || !Array.isArray(data.messages)) throw new ChatError('format');
  if(data.type === 'personal_chat' || data.type === 'bot_chat' || data.type === 'saved_messages') throw new ChatError('personal');
  if(data.type && data.type.includes('channel')) throw new ChatError('channel');

  // reply_to_peer_id can name this very group (a quote-reply); only a different peer means another chat
  const selfPeer = data.id != null ? 'channel' + data.id : null;
  const external = m => !!m.reply_to_peer_id && m.reply_to_peer_id !== selfPeer;
  const byId = new Map();
  for(const m of data.messages) byId.set(m.id, m);

  const topics = new Map([['general', {id:'general', name:'General', n:0, renamed:false}]]);
  for(const m of data.messages) if(m.type === 'service' && m.action === 'topic_created') topics.set(m.id, {id:m.id, name:m.title || 'Топик', n:0, renamed:false});

  const memo = new Map();
  const topicOf = m => {
    const chain = []; let cur = m, res;
    for(;;){
      if(memo.has(cur.id)){ res = memo.get(cur.id); break; }
      chain.push(cur.id);
      if(cur.type === 'service' && cur.action === 'topic_created'){ res = cur.id; break; }
      const rid = cur.reply_to_message_id;
      if(rid == null || external(cur)){ res = 'general'; break; }
      if(topics.has(rid)){ res = rid; break; }
      const t = byId.get(rid);
      if(!t || chain.length > 10000){ res = 'general'; break; }
      cur = t;
    }
    for(const id of chain) memo.set(id, res);
    return res;
  };

  // A rename does not say which topic it belongs to: attach it to the topic of the message right before it.
  let lastTopic = 'general';
  const people = new Map();
  for(const m of data.messages){
    if(m.type === 'message'){
      lastTopic = topicOf(m);
      topics.get(lastTopic).n++;
      const id = authorId(m);
      const p = people.get(id);
      if(p){ p.n++; if(m.from) p.name = m.from; } else people.set(id, {id, name:m.from || 'Удалённый аккаунт', n:1});
    } else if(m.type === 'service' && m.action === 'topic_edit' && m.new_title){
      const target = (m.reply_to_message_id != null && topics.has(m.reply_to_message_id)) ? m.reply_to_message_id : lastTopic;
      const t = topics.get(target); t.name = m.new_title; t.renamed = true;
    }
  }
  if(people.size < 2) throw new ChatError('oneSide');
  const participants = [...people.values()].sort((a,b) => b.n - a.n);
  const topicList = [...topics.values()].filter(t => t.n > 0 || t.id !== 'general').sort((a,b) => b.n - a.n);
  return {byId, topics, topicList, topicOf, external, participants, forum:topics.size > 1};
}

function computeGroup(data, info){
  const ids = info.participants.map(p => p.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const N = ids.length;
  const zeros = () => Array.from({length:N}, () => Array(N).fill(0));
  const replies = zeros(), reacts = zeros();
  const mkMedia = () => ({text:0, photo:0, voice:0, videoNote:0, sticker:0, gif:0, video:0, audio:0, file:0, other:0});

  const P = info.participants.map(p => ({
    id:p.id, name:p.name, n:0, lens:[], hours:Array(24).fill(0), weekdays:Array(7).fill(0), topics:new Map(), media:mkMedia(),
    memes:0, memeReacts:0, forwards:0, polls:0, pinned:0, rGot:0, rGiven:0,
    starts:0, ignited:0, startedLens:[], emoji:new Map(), rEmojiGiven:new Map(), words:new Map()
  }));

  const nameKeys = new Set();
  for(const n of [data.name || '', ...info.participants.map(p => p.name)])
    for(let w of (n.toLowerCase().match(/[a-zа-яё]+/g) || [])){ w = w.replace(/ё/g, 'е'); if(w.length >= 2) nameKeys.add(keyOf(w)); }

  const hours = Array(24).fill(0), weekdays = Array(7).fill(0), days = new Map(), months = new Map();
  const media = mkMedia(), groupEmoji = new Map(), reactionEmoji = new Map(), groupWords = new Map();
  const polls = {count:0, voters:0, byTopic:new Map()};
  const sess = new Map();
  let total = 0, convos = 0, ignitedTotal = 0, first = null, last = null, reactionsTotal = 0;

  const closeS = s => {
    const p = P[idx.get(s.starter)]; p.starts++; p.startedLens.push(s.n); convos++;
    if(s.authors.size >= IGNITE_MIN){ p.ignited++; ignitedTotal++; }
  };

  for(const m of data.messages){
    if(m.type === 'service'){
      if(m.action === 'pin_message' && m.message_id != null){
        const t = info.byId.get(m.message_id);
        if(t && t.type === 'message' && idx.has(authorId(t))) P[idx.get(authorId(t))].pinned++;
      }
      continue;
    }
    if(m.type !== 'message') continue;
    const a = authorId(m), ai = idx.get(a); if(ai == null) continue;
    const p = P[ai], topic = info.topicOf(m);
    p.n++; total++;
    p.topics.set(topic, (p.topics.get(topic) || 0) + 1);

    const ds = m.date || '', day = ds.slice(0, 10), h = parseInt(ds.slice(11, 13), 10);
    if(day.length === 10){
      days.set(day, (days.get(day) || 0) + 1);
      if(!first || day < first) first = day;
      if(!last || day > last) last = day;
      const mo = day.slice(0, 7); months.set(mo, (months.get(mo) || 0) + 1);
      const w = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7; weekdays[w]++; p.weekdays[w]++;
    }
    if(h >= 0 && h < 24){ hours[h]++; p.hours[h]++; }

    const ts = m.date_unixtime ? +m.date_unixtime : Date.parse(ds) / 1000;
    let s = sess.get(topic);
    if(!s || ts - s.last > SESSION_GAP){ if(s) closeS(s); s = {starter:a, authors:new Set(), n:0, last:ts}; sess.set(topic, s); }
    s.authors.add(a); s.n++; s.last = ts;

    // a real reply: points at a person's message, not at the topic itself
    const rid = m.reply_to_message_id;
    if(rid != null && !info.external(m) && !info.topics.has(rid)){
      const tg = info.byId.get(rid);
      if(tg && tg.type === 'message'){ const ti = idx.get(authorId(tg)); if(ti != null && ti !== ai) replies[ai][ti]++; }
    }

    let got = 0;
    for(const r of (m.reactions || [])){
      const e = r.emoji || (r.type === 'custom_emoji' ? '✨' : '•');
      const recent = r.recent || [];
      const self = recent.filter(g => g.from_id === a).length;
      const cnt = Math.max(0, (r.count || recent.length) - self);
      got += cnt; reactionsTotal += cnt;
      if(cnt){ const ek = normE(e), v = reactionEmoji.get(ek); if(v) v.n += cnt; else reactionEmoji.set(ek, {n:cnt, d:e}); }
      for(const g of recent){
        if(g.from_id === a) continue;
        const gi = idx.get(g.from_id); if(gi == null) continue;
        reacts[gi][ai]++; P[gi].rGiven++; bump(P[gi].rEmojiGiven, normE(e), e);
      }
    }
    p.rGot += got;

    const kind = classify(m); p.media[kind]++; media[kind]++;
    if(MEME_KINDS.has(kind)){ p.memes++; p.memeReacts += got; }
    if(m.forwarded_from || m.forwarded_from_id) p.forwards++;
    if(m.poll){ p.polls++; polls.count++; polls.voters += m.poll.total_voters || 0; polls.byTopic.set(topic, (polls.byTopic.get(topic) || 0) + 1); }
    if(m.forwarded_from) continue;
    const t = textOf(m); if(!t || !t.trim()) continue;
    p.lens.push([...t].length);
    emojiScan(t, p.emoji); emojiScan(t, groupEmoji);
    wordScan(t, p.words, nameKeys); wordScan(t, groupWords, nameKeys);
  }
  for(const s of sess.values()) closeS(s);

  // calendar
  const dn = [...days.keys()].map(d => Date.UTC(+d.slice(0,4), +d.slice(5,7) - 1, +d.slice(8,10)) / 864e5).sort((a,b) => a - b);
  let streak = 0, run = 0, prev = null;
  for(const x of dn){ run = (prev !== null && x - prev === 1) ? run + 1 : 1; if(run > streak) streak = run; prev = x; }
  const maxEntry = map => { let k = null, n = 0; for(const [kk, v] of map) if(v > n){ n = v; k = kk; } return {key:k, n}; };

  // distinctive words: what a person says much more often than everyone else
  const wordTotals = P.map(p => { let s = 0; for(const v of p.words.values()) s += v.n; return s; });
  const allWords = wordTotals.reduce((a, b) => a + b, 0);
  const bestForm = v => { let best = '', bn = 0; for(const [f, n] of v.forms) if(n > bn){ bn = n; best = f; } return best; };
  const distinct = i => {
    const p = P[i], Wp = wordTotals[i], Wo = allWords - Wp; if(!Wp) return [];
    const out = [];
    for(const [k, v] of p.words){
      if(v.n < 4) continue;
      const g = groupWords.get(k).n;
      const score = ((v.n + 0.5) / Wp) / ((g - v.n + 0.5) / Math.max(1, Wo));
      out.push({key:k, d:bestForm(v), n:v.n, score});
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 5).map(({key, d, n}) => ({key, d, n}));
  };

  const people = P.map((p, i) => ({
    id:p.id, name:p.name, n:p.n,
    share:total ? r2(p.n / total) : 0,
    medianLen:Math.round(median(p.lens)),
    nightShare:p.n ? r2(p.hours.slice(0, 6).reduce((a,b) => a + b, 0) / p.n) : 0,
    hours:p.hours, weekdays:p.weekdays,
    topics:Object.fromEntries([...p.topics].map(([k, v]) => [String(k), v])),
    media:p.media,
    memes:p.memes, memeAvg:p.memes ? r2(p.memeReacts / p.memes) : 0,
    forwards:p.forwards, polls:p.polls, pinned:p.pinned,
    reactionsGot:p.rGot, reactionsPerMsg:p.n ? r2(p.rGot / p.n) : 0, reactionsGiven:p.rGiven,
    starts:p.starts, ignited:p.ignited, startedMedianLen:Math.round(median(p.startedLens)),
    emoji:topList(p.emoji, 5).map(x => ({d:x.d, n:x.n})),
    reactionEmojiGiven:topList(p.rEmojiGiven, 3).map(x => ({d:x.d, n:x.n})),
    words:distinct(i)
  }));

  const busiestDay = maxEntry(days), busiestMonth = maxEntry(months);
  const wordList = [...groupWords.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([key, v]) => ({key, d:bestForm(v), n:v.n}));

  return {
    chatName:data.name || '', period:{from:first, to:last}, total, convos, ignited:ignitedTotal,
    activeDays:days.size, streak, busiestDay:{date:busiestDay.key, n:busiestDay.n}, busiestMonth:{month:busiestMonth.key, n:busiestMonth.n},
    hours, weekdays, media,
    topics:info.topicList.map(t => ({id:String(t.id), name:t.name, n:t.n})),
    people, ids,
    replies, reacts, reactionsTotal,
    groupEmoji:topList(groupEmoji, 10).map(x => ({d:x.d, n:x.n})),
    reactionEmoji:topList(reactionEmoji, 10).map(x => ({d:x.d, n:x.n})),
    words:wordList,
    polls:{count:polls.count, avgVoters:polls.count ? r1(polls.voters / polls.count) : 0, byTopic:Object.fromEntries([...polls.byTopic].map(([k, v]) => [String(k), v]))}
  };
}

// Invented group used for the first view
function makeGroupSample(){
  let seed = 23; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const any = a => a[Math.floor(rnd() * a.length)];
  const wpick = arr => { const s = arr.reduce((a, x) => a + x[1], 0); let r = rnd() * s; for(const x of arr){ r -= x[1]; if(r <= 0) return x[0]; } return arr[arr.length - 1][0]; };
  const people = [['Аня',1.5],['Боря',1.1],['Вика',0.7],['Гоша',1.3],['Дима',0.5],['Женя',0.9]];
  const pid = name => 'user' + (people.findIndex(p => p[0] === name) + 1);
  const vocab = ['кубы','партия','пицца','шавуха','мастер','кампания','дракон','персонаж','инициатива','лут','квест','роллы','субботу','таверна','крит','бургер','суши','спасибо','мем','кринж'];
  const filler = ['ну','да','это','просто','короче','там','я','ты','вообще','кто','давай','может','ахаха','сегодня'];
  const emo = ['😂','🔥','🤡','😭','❤️','🎲','👍'];
  const reac = ['😁','🔥','🤣','❤️','👍','😭'];
  const fmt = t => new Date(t * 1000).toISOString().slice(0, 19);
  const msgs = []; let id = 1;
  let t = Date.UTC(2025, 4, 29, 12) / 1000; const end = Date.UTC(2026, 9, 7) / 1000;
  const topicDefs = [{root:2, title:'Мемасная', w:0.3, meme:0.55}, {root:3, title:'Ланч-опрос!', w:0.22, meme:0.03}, {root:4, title:'Флуд', w:0.36, meme:0.06}, {root:null, title:'General', w:0.12, meme:0.05}];
  msgs.push({id:id++, type:'service', date:fmt(t), date_unixtime:String(t), actor:'Аня', actor_id:'user1', action:'create_group', title:'Пятничные кубы', text:''});
  for(const d of topicDefs) if(d.root){ msgs.push({id:d.root, type:'service', date:fmt(t), date_unixtime:String(t), actor:'Аня', actor_id:'user1', action:'topic_created', title:d.title, text:''}); id = d.root + 1; }
  const userMsgs = [];
  while(t < end){
    const topic = wpick(topicDefs.map(d => [d, d.w]));
    const cast = []; const k = 2 + Math.floor(rnd() * 3);
    while(cast.length < k){ const p = wpick(people.map(p => [p[0], p[1]])); if(!cast.includes(p)) cast.push(p); }
    const len = 2 + Math.floor(rnd() * 18); let prevId = null;
    for(let i = 0; i < len; i++){
      const who = i === 0 ? cast[0] : any(cast);
      const m = {id:id++, type:'message', date:fmt(t), date_unixtime:String(Math.floor(t)), from:who, from_id:pid(who), text:''};
      if(prevId && rnd() < 0.35) m.reply_to_message_id = prevId; else if(topic.root) m.reply_to_message_id = topic.root;
      const r = rnd();
      if(r < topic.meme * (i === 0 ? 1.4 : 0.6)){ m.photo = '(File not included)'; if(rnd() < 0.3) m.forwarded_from = 'Канал с мемами'; }
      else if(topic.root === 3 && i === 0 && rnd() < 0.5){ m.poll = {question:'', closed:true, total_voters:2 + Math.floor(rnd() * 4), answers:[]}; }
      else if(r < 0.7 && rnd() < 0.05){ m.media_type = 'sticker'; m.sticker_emoji = any(emo); m.file = '(File not included)'; }
      else if(rnd() < 0.03){ m.media_type = 'animation'; m.file = '(File not included)'; }
      else { const n = 1 + Math.floor(rnd() * 9), ws = []; for(let j = 0; j < n; j++) ws.push(rnd() < 0.32 ? any(vocab) : any(filler)); if(who === 'Гоша' && rnd() < 0.4) ws.push('погнали'); if(rnd() < 0.2) ws.push(any(emo)); m.text = ws.join(' '); }
      if(rnd() < 0.15) m.edited = m.date;
      const rp = m.photo ? 0.65 : 0.22;
      if(rnd() < rp){
        const givers = people.map(p => p[0]).filter(n => n !== who && rnd() < (n === 'Вика' ? 0.6 : 0.3));
        if(givers.length){ const byE = new Map(); for(const g of givers){ const e = any(reac); if(!byE.has(e)) byE.set(e, []); byE.get(e).push({from:g, from_id:pid(g), date:m.date}); }
          m.reactions = [...byE].map(([e, rec]) => ({type:'emoji', count:rec.length, emoji:e, recent:rec})); }
      }
      msgs.push(m); userMsgs.push(m.id); prevId = m.id;
      t += 15 + rnd() * 500;
    }
    if(rnd() < 0.03 && userMsgs.length) msgs.push({id:id++, type:'service', date:fmt(t), date_unixtime:String(Math.floor(t)), actor:'Аня', actor_id:'user1', action:'pin_message', message_id:userMsgs[userMsgs.length - 1 - Math.floor(rnd() * 5)], text:''});
    t += 3600 * (2 + rnd() * 30);
  }
  return {name:'Пятничные кубы', type:'private_supergroup', id:1, messages:msgs};
}

/* ---------- roles: who wins which award (text lives in ui/group.js) ---------- */
const othersAvg = (st, i, f) => { const o = st.people.filter((_, j) => j !== i); return o.length ? o.reduce((a, p) => a + f(p), 0) / o.length : 0; };
const ROLE_SCORES = [
  ['mainVoice', 'Главный голос', p => p.n],
  ['memer', 'Мемолог', p => p.memes],
  ['memeHits', 'Чьи мемы заходят', p => p.memes >= 10 ? p.memeAvg : 0],
  ['crowdFavourite', 'Любимец публики', p => p.reactionsPerMsg],
  ['generous', 'Щедрый на реакции', p => p.reactionsGiven],
  ['igniter', 'Зажигалка', p => p.ignited],
  ['nightShift', 'Ночная смена', p => p.nightShare],
  ['pollster', 'Организатор опросов', p => p.polls],
  ['postman', 'Почтальон', p => p.forwards],
  ['truth', 'Голос истины', p => p.pinned],
  ['writer', 'Писатель', p => p.medianLen],
  ['brevity', 'Краткость', p => p.medianLen ? 1 / p.medianLen : 0]
];
// Winner and runner-up per award; only people with enough messages compete.
// Returns [{key, title, i, v, second}] where i / second are indexes into st.people.
function rankRoles(st){
  const minN = Math.max(20, st.total * 0.02);
  const pool = st.people.map((p, i) => ({p, i})).filter(x => x.p.n >= minN);
  return ROLE_SCORES.map(([key, title, f]) => {
    const ranked = pool.map(x => ({...x, v:f(x.p)})).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    if(!ranked.length) return null;
    const w = ranked[0];
    return {key, title, i:w.i, v:w.v, second:ranked[1] ? ranked[1].i : null};
  }).filter(Boolean);
}

// The birthday person against everyone else
function birthdayStats(st, bi){
  const p = st.people[bi], others = st.people.filter((_, j) => j !== bi);
  const oMemes = others.reduce((a, q) => a + q.memes, 0);
  const oN = others.reduce((a, q) => a + q.n, 0);
  const oStarts = others.reduce((a, q) => a + q.starts, 0), oIgn = others.reduce((a, q) => a + q.ignited, 0);
  return {
    rank: [...st.people].sort((a, b) => b.n - a.n).findIndex(x => x.id === p.id) + 1,
    topicTotal: st.topics.reduce((a, t) => a + t.n, 0) || 1,
    oMemeAvg: oMemes ? others.reduce((a, q) => a + q.memeAvg * q.memes, 0) / oMemes : 0,
    oReactAvg: oN ? others.reduce((a, q) => a + q.reactionsGot, 0) / oN : 0,
    myIgnRate: p.starts ? p.ignited / p.starts : 0,
    oIgnRate: oStarts ? oIgn / oStarts : 0,
    groupNight: st.hours.slice(0, 6).reduce((a, b) => a + b, 0) / st.total
  };
}

// The contract that goes to the organiser. `roles` carry a pre-rendered `value` line from the UI.
function buildGroupGenome(st, bId, names, roles){
  return {
    version:1, kind:'group', chat:st.chatName, birthdayId:bId,
    period:st.period, totals:{messages:st.total, participants:st.people.length, activeDays:st.activeDays, longestStreak:st.streak, conversations:st.convos, ignited:st.ignited, reactions:st.reactionsTotal},
    busiestDay:st.busiestDay, busiestMonth:st.busiestMonth,
    topics:st.topics.map(t => ({id:t.id, name:names[t.id] || t.name, n:t.n})),
    hours:st.hours, weekdays:st.weekdays, media:st.media, polls:st.polls,
    people:st.people.map(p => ({...p, isBirthday:p.id === bId})),
    replies:st.replies, reacts:st.reacts,
    roles:roles.map(r => ({title:r.title, id:st.people[r.i].id, name:st.people[r.i].name, value:r.value, secondId:r.second != null ? st.people[r.second].id : null})),
    groupEmoji:st.groupEmoji, reactionEmoji:st.reactionEmoji, words:st.words.slice(0, 30).map(w => [w.d, w.n])
  };
}
