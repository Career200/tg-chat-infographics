/* Personal-chat analysis (no DOM). Needs core/common.js. */
const GAP_SEC = 4 * 3600; // a pause longer than this starts a new conversation

// Step A: validate the export and find who is who
function inspect(data){
  if(data && data.chats && Array.isArray(data.chats.list)) throw new ChatError('full');
  if(!data || !Array.isArray(data.messages)) throw new ChatError('format');
  if(data.type && !['personal_chat','bot_chat'].includes(data.type)) throw new ChatError('group');
  const authors = new Map();
  for(const m of data.messages){
    if(m.type !== 'message') continue;
    const id = authorId(m);
    const a = authors.get(id);
    if(a) a.n++; else authors.set(id, {id, name:m.from || 'Без имени', n:1});
  }
  if(authors.size < 2) throw new ChatError('oneSide');
  const list = [...authors.values()].sort((a,b) => b.n - a.n).slice(0, 2);
  const byChat = data.id != null ? list.find(a => a.id === 'user' + data.id) : null;
  return {authors:list, guess:(byChat || list[1]).id};
}

// Step B: crunch numbers for a chosen birthday person
function compute(data, bId){
  const mk = () => ({n:0, lens:[], starts:0, replies:[], emoji:new Map(), stick:new Map()});
  const S = {f:mk(), b:mk()};
  const hours = Array(24).fill(0), wd = Array(7).fill(0), days = new Set(), months = new Map();
  const media = {text:0, photo:0, voice:0, videoNote:0, sticker:0, gif:0, video:0, audio:0, file:0, other:0};
  const words = new Map();
  const nameKeys = new Set();
  const names = [data.name || ''];
  for(const m of data.messages) if(m.type === 'message' && m.from) names.push(m.from);
  for(const n of new Set(names)) for(let w of (n.toLowerCase().match(/[a-zа-яё]+/g) || [])){ w = w.replace(/ё/g,'е'); if(w.length >= 2) nameKeys.add(keyOf(w)); }

  let total = 0, convos = 0, calls = 0, callSec = 0, prevTs = null, prevSide = null, first = null, last = null;
  // conversations opened with a picture / video / gif: did the other side engage?
  const mkMs = () => ({count:0, ignored:0, oneReply:0, continued:0});
  const memeAcc = {f:mkMs(), b:mkMs()}, textAcc = {count:0, continued:0};
  let cur = null;
  const closeConvo = () => {
    if(!cur) return;
    if(cur.media){
      const a = memeAcc[cur.side]; a.count++;
      if(cur.switches === 0) a.ignored++; else if(cur.switches === 1) a.oneReply++; else a.continued++;
    } else if(cur.text){
      textAcc.count++; if(cur.switches >= 2) textAcc.continued++;
    }
  };
  for(const m of data.messages){
    if(m.type === 'service'){
      if(m.action === 'phone_call' && m.duration_seconds > 0){ calls++; callSec += m.duration_seconds; }
      continue;
    }
    if(m.type !== 'message') continue;
    const side = authorId(m) === bId ? 'b' : 'f';
    const s = S[side]; s.n++; total++;
    const ds = m.date || '', day = ds.slice(0, 10), h = parseInt(ds.slice(11, 13), 10);
    if(day.length === 10){
      days.add(day);
      if(!first || day < first) first = day;
      if(!last || day > last) last = day;
      const mo = day.slice(0, 7); months.set(mo, (months.get(mo) || 0) + 1);
      wd[(new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7]++;
    }
    if(h >= 0 && h < 24) hours[h]++;
    const ts = m.date_unixtime ? +m.date_unixtime : Date.parse(ds) / 1000;
    const kind = classify(m); media[kind]++;
    if(prevTs === null || ts - prevTs > GAP_SEC){
      s.starts++; convos++;
      closeConvo();
      cur = {side, media:MEDIA_START.has(kind), text:kind === 'text', switches:0, last:side};
    } else {
      if(side !== prevSide) s.replies.push((ts - prevTs) / 60);
      if(side !== cur.last){ cur.switches++; cur.last = side; }
    }
    prevTs = ts; prevSide = side;

    if(kind === 'sticker' && m.sticker_emoji) bump(s.stick, normE(m.sticker_emoji), m.sticker_emoji);
    if(m.forwarded_from) continue;
    const t = textOf(m); if(!t || !t.trim()) continue;
    s.lens.push([...t].length);
    emojiScan(t, s.emoji);
    wordScan(t, words, nameKeys);
  }

  closeConvo();
  const memeOut = k => { const a = memeAcc[k], st = S[k].starts;
    return {count:a.count, ofStarts:st ? r2(a.count / st) : 0,
      ignored:a.count ? r2(a.ignored / a.count) : 0, oneReply:a.count ? r2(a.oneReply / a.count) : 0, continued:a.count ? r2(a.continued / a.count) : 0}; };
  const dn = [...days].map(d => Date.UTC(+d.slice(0,4), +d.slice(5,7) - 1, +d.slice(8,10)) / 864e5).sort((a,b) => a - b);
  let streak = 0, run = 0, prev = null;
  for(const x of dn){ run = (prev !== null && x - prev === 1) ? run + 1 : 1; if(run > streak) streak = run; prev = x; }
  let peakMonth = null, peakN = 0;
  for(const [mo, n] of months) if(n > peakN){ peakN = n; peakMonth = mo; }

  const side = k => { const s = S[k]; return {
    messages:s.n, share:total ? r2(s.n / total) : 0, medianLen:Math.round(median(s.lens)),
    startsConvos:convos ? r2(s.starts / convos) : 0, medianReplyMin:r1(median(s.replies)) }; };
  const wordList = [...words.entries()].sort((a,b) => b[1].n - a[1].n).slice(0, 120).map(([key, v]) => {
    let best = '', bn = 0; for(const [f, n] of v.forms) if(n > bn){ bn = n; best = f; }
    return {key, d:best, n:v.n};
  });
  return {
    total, convos, first, last, activeDays:days.size, streak, peakMonth, peakN,
    calls, callMin:Math.round(callSec / 60),
    sides:{friend:side('f'), birthday:side('b')},
    hours, weekdays:wd,
    nightShare:total ? r2(hours.slice(0, 6).reduce((a,b) => a + b, 0) / total) : 0,
    medianReplyMin:r1(median(S.f.replies.concat(S.b.replies))),
    media,
    memeStarts:{friend:memeOut('f'), birthday:memeOut('b')},
    textStartsContinued:textAcc.count ? r2(textAcc.continued / textAcc.count) : 0,
    cand:{ ef:topList(S.f.emoji, 15), eb:topList(S.b.emoji, 15), sf:topList(S.f.stick, 15), sb:topList(S.b.stick, 15), words:wordList }
  };
}

const MEDIA_START = new Set(['photo','video','gif']);
const pick = (list, excl, k = 3) => list.filter(x => !excl.has(x.key)).slice(0, k);
// "every Nth conversation" from the share of conversations someone opens with a meme
const memeEvery = ofStarts => Math.max(1, Math.round(1 / Math.max(ofStarts, 0.001)));

// Step C: the contract that goes to the organiser
const PICK_SHOW = 20, PICK_MAX = 5;
function buildGenome(st, excl, friendName, picked = new Set()){
  const media = {}; for(const k in st.media) media[k] = st.total ? Math.round(st.media[k] / st.total * 1000) / 1000 : 0;
  const pairs = (list, ex) => pick(list, ex).map(x => [x.d, x.n]);
  return {
    version:1,
    friend:friendName,
    period:{from:st.first, to:st.last},
    totals:{messages:st.total, activeDays:st.activeDays, longestStreak:st.streak, conversations:st.convos},
    peakMonth:st.peakMonth,
    calls:{count:st.calls, minutes:st.callMin},
    bySide:{
      friend:{share:st.sides.friend.share, medianLen:st.sides.friend.medianLen, startsConvos:st.sides.friend.startsConvos, medianReplyMin:st.sides.friend.medianReplyMin},
      birthday:{share:st.sides.birthday.share, medianLen:st.sides.birthday.medianLen, startsConvos:st.sides.birthday.startsConvos, medianReplyMin:st.sides.birthday.medianReplyMin}
    },
    hours:st.hours, weekdays:st.weekdays, nightShare:st.nightShare,
    medianReplyMin:st.medianReplyMin,
    media,
    memeStarts:st.memeStarts,
    textStartsContinued:st.textStartsContinued,
    emoji:{friend:pairs(st.cand.ef, excl.ef), birthday:pairs(st.cand.eb, excl.eb)},
    stickerEmoji:{friend:pairs(st.cand.sf, excl.sf), birthday:pairs(st.cand.sb, excl.sb)},
    topWords:pick(st.cand.words, excl.words).map(x => x.d),
    pickedWords:st.cand.words.filter(x => picked.has(x.key) && !excl.words.has(x.key)).map(x => [x.d, x.n])
  };
}

// Invented chat used for the first view
function makeSample(){
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const any = a => a[Math.floor(rnd() * a.length)];
  const vocab = ['шавуха','созвон','кринж','катка','дедлайн','электричка','пицца','котик','рофл','баня','кино','спортзал','самокат','тарантино','хинкали','вайб','бургер','сериал','концерт','дача','шаурмичная','ипотека','бабушка','гитара'];
  const filler = ['ну','да','это','просто','короче','вообще','там','я','ты','вечером','давай','может','пойдём','надо','сегодня','ахаха'];
  const emoF = ['😂','😂','🔥','👍','❤️','😭'], emoB = ['😂','😂','😂','🤡','🙃','❤️','😎'];
  const stF = ['🐸','👍','🔥','😴'], stB = ['😎','🙃','🤝','😎','🐸'];
  const hoursPool = [9,11,13,14,17,18,19,20,20,21,21,22,22,23,23,0,0,1,2];
  const fmt = t => new Date(t * 1000).toISOString().slice(0, 19);
  const msgs = []; let id = 1;
  let t = Date.UTC(2023, 2, 4, 20) / 1000; const end = Date.UTC(2026, 9, 6) / 1000;
  while(t < end){
    let side = rnd() < 0.58 ? 1 : 2;
    const len = 2 + Math.floor(rnd() * 16);
    for(let i = 0; i < len; i++){
      const m = {id:id++, type:'message', date:fmt(t), date_unixtime:String(Math.floor(t)),
        from:side === 1 ? 'Аня' : 'Именинник', from_id:'user' + side, text:''};
      const r = (i === 0 && rnd() < 0.22) ? 0.13 : rnd(); // some conversations open with a meme
      if(r < 0.08){ m.media_type = 'sticker'; m.sticker_emoji = any(side === 1 ? stF : stB); m.file = '(File not included)'; }
      else if(r < 0.12){ m.media_type = 'voice_message'; m.file = '(File not included)'; }
      else if(r < 0.15){ m.photo = '(File not included)'; }
      else if(r < 0.16){ m.media_type = 'video_message'; m.file = '(File not included)'; }
      else if(r < 0.18){ m.media_type = 'animation'; m.file = '(File not included)'; }
      else {
        const n = 1 + Math.floor(rnd() * (side === 1 ? 7 : 11)); const ws = [];
        for(let j = 0; j < n; j++) ws.push(rnd() < 0.3 ? any(vocab) : any(filler));
        if(rnd() < 0.28) ws.push(any(side === 1 ? emoF : emoB));
        m.text = ws.join(' ');
      }
      msgs.push(m);
      t += 20 + rnd() * 400;
      if(rnd() < 0.55) side = 3 - side;
    }
    if(rnd() < 0.04) msgs.push({id:id++, type:'service', date:fmt(t), date_unixtime:String(Math.floor(t)), action:'phone_call', duration_seconds:Math.floor(120 + rnd() * 2400)});
    const day = Math.floor(t / 86400) + 1 + Math.floor(rnd() * 2.2);
    t = day * 86400 + any(hoursPool) * 3600 + rnd() * 3000;
  }
  return {name:'Именинник', type:'personal_chat', id:2, messages:msgs};
}
