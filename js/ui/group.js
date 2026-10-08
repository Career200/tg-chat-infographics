/* Group-chat page: state, rendering, events. Needs core/common.js, core/group.js, ui/common.js. */
const fmtD = (n, d = 2) => n.toLocaleString('ru-RU', {minimumFractionDigits:0, maximumFractionDigits:d});
const pct = x => Math.round(x * 100) + '%';
const fmtDay = d => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'}).replace(/\s?г\.?$/, '') : '—';
const heat = (v, max) => `background:color-mix(in oklab, var(--accent) ${max ? Math.round(v / max * 100) : 0}%, var(--cell))`;
const fmtMonthL = ym => fmtMonth(ym, 'long');
Object.assign(ERRORS, {
  full:'Это выгрузка всего аккаунта. Нужна выгрузка одного группового чата.',
  personal:'Это личный чат. Для него есть ' + pageLink('personal', 'отдельная страница') + ', а сюда нужен общий чат компании.',
  channel:'Это канал. Сюда нужен групповой чат, где пишут все участники.',
  oneSide:'В выгрузке пишет только один человек. Проверь, что выгружен общий чат.'
});

let S = null; // {data, info, st, bId, sample, names}

const color = i => i < 8 ? `var(--p${i + 1})` : 'var(--p-other)';
const dot = i => `<span class="pdot" style="background:${color(i)}"></span>`;
const pname = i => esc(S.st.people[i].name);
const who = i => `<span class="who-n">${dot(i)}${pname(i)}${S.st.people[i].id === S.bId ? '<span class="star" title="Именинник">★</span>' : ''}</span>`;
const tname = id => esc(S.names[id] ?? (S.st.topics.find(t => t.id === id) || {}).name ?? id);

function load(data, sample){
  const info = inspectGroup(data);
  const st = computeGroup(data, info);
  S = {data, info, st, sample, bId:sample ? 'user4' : null, names:{}, gender:(S && S.gender) || 'm'};
  for(const t of st.topics) S.names[t.id] = t.name;
  renderSetup(); render();
}

/* ---------- setup: birthday radio + topic names ---------- */
function renderSetup(){
  $('sampleNote').hidden = !S.sample;
  $('setup').hidden = false;
  $('bdayList').innerHTML = S.st.people.map((p, i) =>
    `<label class="radio"><input type="radio" name="bday" id="bday-${i}" value="${esc(p.id)}" ${p.id === S.bId ? 'checked' : ''}>${dot(i)}<span>${esc(p.name)}</span><span class="muted">${fmtN(p.n)} ${plural(p.n, 'сообщение', 'сообщения', 'сообщений')}</span></label>`).join('')
    + `<div class="gender" role="radiogroup" aria-label="Как писать об имениннике"><span class="small muted">Писать в тексте:</span>
       <label><input type="radio" name="gender" id="g-m" value="m" ${S.gender === 'm' ? 'checked' : ''}> он</label>
       <label><input type="radio" name="gender" id="g-f" value="f" ${S.gender === 'f' ? 'checked' : ''}> она</label></div>`;
  const multi = S.st.topics.length > 1;
  $('topicBox').hidden = !multi;
  if(multi) $('topicList').innerHTML = S.st.topics.map(t =>
    `<label class="topic-in"><input type="text" id="topic-${esc(t.id)}" data-topic="${esc(t.id)}" value="${esc(S.names[t.id])}"><span class="muted">${fmtN(t.n)}</span></label>`).join('');
}
$('bdayList').addEventListener('change', e => { if(e.target.name === 'bday'){ S.bId = e.target.value; render(); } else if(e.target.name === 'gender'){ S.gender = e.target.value; render(); } });
$('topicList').addEventListener('input', e => { const id = e.target.dataset.topic; if(id){ S.names[id] = e.target.value.trim() || id; render(); } });

/* ---------- small building blocks ---------- */
function bars(items, fmt, opts = {}){
  const max = Math.max(1e-9, ...items.map(x => x.v));
  return `<div class="bars">${items.map(x => `<div class="bar-row${x.i != null && S.st.people[x.i].id === S.bId ? ' is-b' : ''}" title="${esc(x.title || '')}">
      <span class="bar-l">${x.label ?? who(x.i)}</span>
      <span class="bar-t"><span style="width:${Math.max(0.5, x.v / max * 100)}%;background:${x.c || (x.i != null ? color(x.i) : 'var(--accent)')}"></span></span>
      <span class="bar-v">${fmt(x.v, x)}</span></div>`).join('')}</div>`;
}
function matrix(M, rowHead, colHead){
  const n = M.length, max = Math.max(1, ...M.flat());
  const head = `<tr><th class="corner">${rowHead}</th>${S.st.people.map((_, j) => `<th class="mh" title="${pname(j)}">${dot(j)}<span>${esc(S.st.people[j].name.split(' ')[0])}</span></th>`).join('')}</tr>`;
  const rows = M.map((row, i) => `<tr><th class="rh">${who(i)}</th>${row.map((v, j) => i === j ? '<td class="mc self"></td>'
    : `<td class="mc" style="${heat(v, max)}" title="${pname(i)} → ${pname(j)}: ${fmtN(v)}"><span>${v ? fmtN(v) : ''}</span></td>`).join('')}</tr>`).join('');
  return `<div class="scroll"><table class="matrix">${head}${rows}</table></div>`;
}
function gelRow(arr, cls, labels){
  const max = Math.max(1, ...arr);
  return `<div class="gel ${cls}">${arr.map((v, i) => `<div class="c" title="${labels[i]}: ${fmtN(v)}" style="${heat(v, max)}"></div>`).join('')}</div>`;
}
const hourLabels = Array.from({length:24}, (_, i) => `${i}:00`);
const hourAxis = `<div class="gel h axis">${Array.from({length:24}, (_, i) => `<div class="lab">${i % 3 === 0 ? i : ''}</div>`).join('')}</div>`;
function chips(list, cls = ''){ return list.length ? `<div class="chips">${list.map(x => `<span class="chip ${cls}"><span>${esc(x.d)}</span><span class="cnt">${fmtN(x.n)}</span></span>`).join('')}</div>` : '<span class="muted">—</span>'; }
const panel = (title, body, cls = '', sub = '') => `<section class="panel ${cls}"><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}${body}</section>`;

/* ---------- roles: award texts (scores live in core/group.js). Each line says what was counted and against what. ---------- */
const oAvg = (i, f) => othersAvg(S.st, i, f);
const ROLE_TEXT = {
  mainVoice: (v, p) => `${fmtN(v)} ${plural(v, 'сообщение', 'сообщения', 'сообщений')}, это ${pct(p.share)} всего чата`,
  memer: v => `${fmtN(v)} картинок, видео и гифок за всё время`,
  memeHits: (v, p, i) => `одна картинка, видео или гифка собирает в среднем ${fmtD(v)} реакции, у остальных ${fmtD(oAvg(i, q => q.memeAvg))}`,
  crowdFavourite: (v, p, i) => `одно сообщение собирает в среднем ${fmtD(v)} реакции, у остальных ${fmtD(oAvg(i, q => q.reactionsPerMsg))}`,
  generous: v => `${fmtN(v)} реакций на чужие сообщения`,
  igniter: (v, p) => `${fmtN(v)} начатых разговоров подхватили ещё минимум двое, это ${pct(p.starts ? v / p.starts : 0)} всех, что начаты этим человеком`,
  nightShift: v => `${pct(v)} своих сообщений пишет с 0 до 6 утра`,
  pollster: v => `${fmtN(v)} ${plural(v, 'опрос создан', 'опроса создано', 'опросов создано')}`,
  postman: v => `${fmtN(v)} ${plural(v, 'пересланное сообщение', 'пересланных сообщения', 'пересланных сообщений')} из других чатов и каналов`,
  truth: v => `${fmtN(v)} ${plural(v, 'сообщение закрепили', 'сообщения закрепили', 'сообщений закрепили')}`,
  writer: (v, p, i) => `типичное сообщение длиной ${fmtN(v)} символов, у остальных ${fmtN(oAvg(i, q => q.medianLen))}`,
  brevity: (v, p, i) => `типичное сообщение длиной ${fmtN(p.medianLen)} символов, у остальных ${fmtN(oAvg(i, q => q.medianLen))}`
};
const computeRoles = () => rankRoles(S.st).map(r => ({...r, value:ROLE_TEXT[r.key](r.v, S.st.people[r.i], r.i)}));

/* ---------- grammar for the birthday person ---------- */
const G = {
  m:{nom:'он', Nom:'Он', dat:'ему', gen:'его', u:'у него', wrote:'написал', sent:'отправил', got:'получил', gave:'поставил'},
  f:{nom:'она', Nom:'Она', dat:'ей', gen:'её', u:'у неё', wrote:'написала', sent:'отправила', got:'получила', gave:'поставила'}
};

/* ---------- network of replies ---------- */
function network(){
  const st = S.st, n = st.people.length, W = 640, H = 460, cx = W / 2, cy = H / 2 + 6;
  const bi = st.people.findIndex(p => p.id === S.bId);
  const pos = [];
  const ring = [...Array(n).keys()].filter(i => i !== bi);
  const R = Math.min(185, 60 + n * 20);
  if(bi >= 0) pos[bi] = [cx, cy];
  ring.forEach((i, k) => { const a = -Math.PI / 2 + k / ring.length * Math.PI * 2; pos[i] = [cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.86]; });
  const edges = [];
  for(let i = 0; i < n; i++) for(let j = i + 1; j < n; j++){ const w = st.replies[i][j] + st.replies[j][i]; if(w) edges.push({i, j, w}); }
  const maxW = Math.max(1, ...edges.map(e => e.w)), maxShare = Math.max(...st.people.map(p => p.share));
  const lines = edges.sort((a, b) => a.w - b.w).map(e => {
    const hot = e.i === bi || e.j === bi;
    return `<line x1="${pos[e.i][0]}" y1="${pos[e.i][1]}" x2="${pos[e.j][0]}" y2="${pos[e.j][1]}" stroke="${hot ? 'var(--accent)' : 'var(--ink)'}" stroke-opacity="${(hot ? 0.35 : 0.12) + 0.55 * e.w / maxW}" stroke-width="${1 + 11 * e.w / maxW}" stroke-linecap="round"><title>${pname(e.i)} → ${pname(e.j)}: ${st.replies[e.i][e.j]}; ${pname(e.j)} → ${pname(e.i)}: ${st.replies[e.j][e.i]}</title></line>`;
  }).join('');
  const nodes = st.people.map((p, i) => {
    const r = 10 + 18 * Math.sqrt(p.share / maxShare), [x, y] = pos[i], below = y >= cy || i === bi;
    return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="${color(i)}" stroke="var(--surface)" stroke-width="3"><title>${pname(i)}: ${fmtN(p.n)} сообщений</title></circle>
      <text x="${x}" y="${below ? y + r + 16 : y - r - 8}" text-anchor="middle" class="nlabel${i === bi ? ' b' : ''}">${i === bi ? '★ ' : ''}${esc(p.name.split(' ')[0])}</text></g>`;
  }).join('');
  return `<svg class="net" viewBox="0 0 ${W} ${H}" role="img" aria-label="Кто кому отвечает: чем толще линия, тем больше ответов">${lines}${nodes}</svg>`;
}

/* ---------- birthday section ---------- */
function bdaySection(roles){
  const st = S.st, bi = st.people.findIndex(p => p.id === S.bId);
  if(bi < 0) return `<section class="panel span-all bday empty-b"><h3>Именинник в компании</h3><p class="sub">Выбери именинника в списке выше, и здесь появится портрет на фоне группы.</p></section>`;
  const g = G[S.gender], p = st.people[bi], n = st.people.length, first = esc(p.name.split(' ')[0]);
  const {rank, topicTotal:groupTopicTotal, oMemeAvg, oReactAvg, myIgnRate, oIgnRate, groupNight} = birthdayStats(st, bi);
  const top = (arr, k = 3) => arr.map((v, j) => ({j, v})).filter(x => x.j !== bi && x.v > 0).sort((a, b) => b.v - a.v).slice(0, k);
  const col = M => M.map(r => r[bi]);
  const list = (items, u) => items.length ? `<ol class="rank">${items.map(x => `<li>${who(x.j)}<b>${fmtN(x.v)} <small>${plural(x.v, ...u)}</small></b></li>`).join('')}</ol>` : '<span class="muted">—</span>';
  const ANS = ['ответ', 'ответа', 'ответов'], REA = ['реакция', 'реакции', 'реакций'];
  const myRoles = roles.filter(r => r.i === bi), silver = roles.filter(r => r.second === bi);

  return `<section class="panel span-all bday">
    <div class="bday-head">
      <div><p class="eyebrow">Именинник в компании</p><h2>${dot(bi)}${pname(bi)}</h2></div>
      <div class="bday-big"><b>${pct(p.share)}</b><span>всех сообщений чата ${g.wrote} ${g.nom}. Это ${rank}-е место из ${n}. Если бы все писали поровну, у каждого было бы ${pct(1 / n)}.</span></div>
    </div>
    <div class="bday-grid">
      <div class="cell"><h4>Номинации, где ${g.nom} на первом месте</h4>${myRoles.length ? `<div class="badges">${myRoles.map(r => `<span class="badge gold">${esc(r.title)}<small>${r.value}</small></span>`).join('')}</div>` : '<p class="muted">Первых мест нет</p>'}
        ${silver.length ? `<p class="muted small">На втором месте: ${silver.map(r => esc(r.title)).join(', ')}</p>` : ''}</div>
      <div class="cell"><h4>Кому ${g.nom} отвечает чаще всего</h4><p class="muted small">Сколько раз ${g.nom} ответил${S.gender === 'f' ? 'а' : ''} на сообщения этого человека</p>${list(top(st.replies[bi]), ANS)}</div>
      <div class="cell"><h4>Кто чаще всего отвечает ${g.dat}</h4><p class="muted small">Сколько раз человек ответил на ${g.gen} сообщения</p>${list(top(col(st.replies)), ANS)}</div>
      <div class="cell"><h4>Кто ставит ${g.dat} больше всего реакций</h4><p class="muted small">Сколько реакций человек поставил на ${g.gen} сообщения</p>${list(top(col(st.reacts)), REA)}</div>
      <div class="cell"><h4>Кому ${g.nom} ставит больше всего реакций</h4><p class="muted small">Сколько реакций ${g.nom} ${g.gave} на сообщения этого человека</p>${list(top(st.reacts[bi]), REA)}</div>
      <div class="cell"><h4>Как ${g.nom} начинает разговоры</h4><p class="kv"><b>${fmtN(p.starts)}</b> раз ${g.nom} ${g.wrote} первое сообщение после паузы в 3+ часа</p>
        <p class="kv"><b>${pct(myIgnRate)}</b> из них подхватили ещё минимум двое. У остальных так бывает в ${pct(oIgnRate)} случаев</p></div>
      <div class="cell"><h4>Мемы</h4><p class="kv"><b>${fmtN(p.memes)}</b> картинок, видео и гифок ${g.sent} ${g.nom}</p>
        <p class="kv"><b>${fmtD(p.memeAvg)}</b> реакции в среднем собирает одна такая. У остальных ${fmtD(oMemeAvg)}</p></div>
      <div class="cell"><h4>Реакции</h4><p class="kv"><b>${fmtD(p.reactionsPerMsg)}</b> реакции в среднем собирает одно ${g.gen} сообщение. У остальных ${fmtD(oReactAvg)}</p>
        <p class="muted small">Всего ${g.nom} ${g.got} ${fmtN(p.reactionsGot)} реакций и ${g.gave} другим ${fmtN(p.reactionsGiven)}</p></div>
      <div class="cell wide"><h4>В каких топиках ${g.nom} пишет</h4><p class="muted small">Какая доля сообщений приходится на каждый топик: ${g.u} и у всей группы</p>
        <table class="mini"><tr><th></th><th class="num">${first}</th><th class="num">Вся группа</th></tr>${st.topics.map(t => { const me = (p.topics[t.id] || 0) / p.n, all = t.n / groupTopicTotal;
          return `<tr><td>${tname(t.id)}</td><td class="num"><span class="mbar" style="--w:${me * 100}%;--c:${color(bi)}"></span>${pct(me)}</td><td class="num"><span class="mbar" style="--w:${all * 100}%;--c:var(--muted)"></span>${pct(all)}</td></tr>`; }).join('')}</table></div>
      <div class="cell wide"><h4>В какое время ${g.nom} пишет</h4><p class="muted small">Ярче — больше сообщений в этот час. Каждая строка сравнивается сама с собой</p>
        <div class="hrow"><span class="hl">${first}</span>${gelRow(p.hours, 'h', hourLabels)}</div>
        <div class="hrow"><span class="hl">Все</span>${gelRow(st.hours, 'h', hourLabels)}</div>
        <div class="hrow"><span class="hl"></span>${hourAxis}</div>
        <p class="muted small">С 0 до 6 утра пишется ${pct(p.nightShare)} ${g.gen} сообщений и ${pct(groupNight)} сообщений всей группы</p></div>
      <div class="cell"><h4>${g.Nom} пишет это чаще остальных</h4><p class="muted small">Слова, которые ${g.nom} использует заметно чаще других. Число — сколько раз</p>${chips(p.words)}</div>
      <div class="cell"><h4>Эмодзи в ${g.gen} сообщениях</h4><p class="muted small">Число — сколько раз</p>${chips(p.emoji, 'emo')}</div>
    </div>
  </section>`;
}

/* ---------- main render ---------- */
function render(){
  const st = S.st, roles = computeRoles();
  const people = st.people.map((p, i) => ({p, i}));
  const kpis = [
    [`${fmtMonthL(st.period.from && st.period.from.slice(0, 7))} — ${fmtMonthL(st.period.to && st.period.to.slice(0, 7))}`, 'период'],
    [fmtN(st.total), 'сообщений от людей'],
    [fmtN(st.people.length), 'участников'],
    [fmtN(st.activeDays), 'дней, когда кто-то писал'],
    [fmtN(st.streak), 'дней подряд кто-то писал, самая длинная серия'],
    [`${fmtN(st.busiestDay.n)}`, `сообщений в самый бурный день, ${fmtDay(st.busiestDay.date)}`],
    [fmtN(st.convos), 'разговоров. Новый разговор — после паузы в 3+ часа в топике'],
    [fmtN(st.ignited), `разговоров, где писали трое и больше, это ${pct(st.convos ? st.ignited / st.convos : 0)}`],
    [fmtN(st.reactionsTotal), `реакций, в среднем ${fmtD(st.total ? st.reactionsTotal / st.total : 0)} на сообщение`],
  ];
  if(st.polls.count) kpis.push([fmtN(st.polls.count), `опросов, в среднем ${fmtD(st.polls.avgVoters, 1)} проголосовавших`]);

  const topicMax = Math.max(1, ...st.topics.map(t => t.n));
  const topicHeat = st.topics.length > 1 ? `<div class="scroll"><table class="heat-t"><tr><th></th>${st.topics.map(t => `<th class="num">${tname(t.id)}</th>`).join('')}</tr>
    ${people.map(({p, i}) => `<tr class="${p.id === S.bId ? 'is-b' : ''}"><th class="rh">${who(i)}</th>${st.topics.map(t => { const v = p.topics[t.id] || 0, sh = p.n ? v / p.n : 0;
      return `<td class="hc" style="${heat(sh, 1)}" title="${pname(i)} · ${tname(t.id)}: ${fmtN(v)}">${pct(sh)}</td>`; }).join('')}</tr>`).join('')}</table></div>
    <p class="sub">Строка — человек. Число — какая доля всех его сообщений написана в этом топике, строка в сумме даёт 100%.</p>` : '';

  const personHours = `<div class="ph">${people.map(({p, i}) => `<div class="hrow${p.id === S.bId ? ' is-b' : ''}"><span class="hl">${who(i)}</span>${gelRow(p.hours, 'h', hourLabels)}</div>`).join('')}
    <div class="hrow"><span class="hl"></span>${hourAxis}</div></div>`;

  const table = `<div class="scroll"><table class="ptable">
    <tr><th>Участник</th><th class="num">Сообщений</th><th class="num">Доля от всего чата</th><th class="num">Типичная длина сообщения, символов</th><th class="num">Доля своих сообщений с 0 до 6</th><th class="num">Картинок, видео, гифок</th><th class="num">Реакций в среднем на одну картинку</th><th class="num">Реакций в среднем на сообщение</th><th class="num">Реакций поставлено другим</th><th class="num">Начатых разговоров</th><th class="num">Из них подхватили 2+ человека</th><th class="num">Опросов создано</th><th class="num">Пересланных сообщений</th><th class="num">Сообщений закрепили</th></tr>
    ${people.map(({p, i}) => `<tr class="${p.id === S.bId ? 'is-b' : ''}"><th class="rh">${who(i)}</th><td class="num">${fmtN(p.n)}</td><td class="num">${pct(p.share)}</td><td class="num">${fmtN(p.medianLen)}</td><td class="num">${pct(p.nightShare)}</td><td class="num">${fmtN(p.memes)}</td><td class="num">${fmtD(p.memeAvg)}</td><td class="num">${fmtD(p.reactionsPerMsg)}</td><td class="num">${fmtN(p.reactionsGiven)}</td><td class="num">${fmtN(p.starts)}</td><td class="num">${fmtN(p.ignited)}</td><td class="num">${fmtN(p.polls)}</td><td class="num">${fmtN(p.forwards)}</td><td class="num">${fmtN(p.pinned)}</td></tr>`).join('')}
  </table></div>`;

  const MEDIA = [['text','Текст','--m-text'],['photo','Фото','--m-photo'],['video','Видео','--m-video'],['gif','Гифки','--m-gif'],['sticker','Стикеры','--m-sticker'],['voice','Голосовые','--m-voice'],['videoNote','Кружки','--m-vnote'],['audio','Аудио','--m-other'],['file','Файлы','--m-other'],['other','Другое','--m-other']];
  const mixRow = (m, n) => `<div class="mix">${MEDIA.filter(([k]) => m[k]).map(([k, l, c]) => `<span style="width:${m[k] / n * 100}%;background:var(${c})" title="${l}: ${fmtN(m[k])}"></span>`).join('')}</div>`;
  const usedMedia = MEDIA.filter(([k]) => st.media[k]);

  $('report').innerHTML = `
    <div class="kpis span-all">${kpis.map(([v, l]) => `<div class="kpi"><span class="v">${v}</span><span class="l">${l}</span></div>`).join('')}</div>
    ${bdaySection(roles)}
    ${panel('Роли', `<div class="roles">${roles.map(r => `<div class="role${S.st.people[r.i].id === S.bId ? ' is-b' : ''}"><span class="rt">${esc(r.title)}</span>${who(r.i)}<span class="rv">${r.value}</span>${r.second != null ? `<span class="r2">второе место: ${pname(r.second)}</span>` : ''}</div>`).join('')}</div>`, 'span-all', 'Кто на первом месте по каждому показателю, и что именно посчитано. Мелким шрифтом — второе место. Участвуют только те, кто написал хотя бы 2% сообщений чата.')}
    ${panel('Кто сколько пишет', `<p class="sub">Число сообщений и доля от всех сообщений чата</p>` + bars(people.map(({p, i}) => ({i, v:p.n, title:`${p.name}: ${fmtN(p.n)}`})), (v, x) => `${fmtN(v)} · ${pct(st.people[x.i].share)}`))}
    ${panel('Кто кому отвечает', network(), '', 'Линия — сколько раз эти двое отвечали друг другу, в обе стороны вместе: толще — больше. Кружок тем больше, чем больше человек пишет. Считаются только ответы через «Ответить» на конкретное сообщение. Наведи на линию, чтобы увидеть числа.')}
    ${panel('Ответы: кто кому', matrix(st.replies, 'кто ↓ отвечает кому →'), 'span-2', 'Строка — кто отвечает. Столбец — на чьи сообщения. Число — сколько раз.')}
    ${panel('Реакции: кто кому', matrix(st.reacts, 'кто ↓ ставит кому →'), 'span-2', 'Строка — кто ставит реакцию. Столбец — на чьи сообщения. Число — сколько реакций. Telegram сохраняет авторов почти всех реакций, так что картина близка к полной.')}
    ${st.topics.length > 1 ? panel('Топики', bars(st.topics.map(t => ({label:tname(t.id), v:t.n, c:'var(--accent)'})), v => fmtN(v)) + topicHeat, 'span-2') : ''}
    ${panel('Когда пишет группа', `<div class="hrow"><span class="hl">Все</span>${gelRow(st.hours, 'h', hourLabels)}</div><div class="hrow"><span class="hl"></span>${hourAxis}</div>
      <div class="hrow wk"><span class="hl">Дни</span>${gelRow(st.weekdays, 'w', WD)}</div><div class="hrow wk"><span class="hl"></span><div class="gel w axis">${WD.map(d => `<div class="lab">${d}</div>`).join('')}</div></div>
      <p class="sub">Самый активный месяц: ${fmtMonthL(st.busiestMonth.month)}, ${fmtN(st.busiestMonth.n)} сообщений.</p>`)}
    ${panel('Часы каждого', personHours, '', 'Ярче — больше сообщений в этот час. Каждая строка сравнивается сама с собой, поэтому видно, когда человек обычно пишет, а не сколько.')}
    ${panel('Мемы', `<h4 class="h4">Сколько картинок, видео и гифок отправлено</h4>` + bars(people.map(({p, i}) => ({i, v:p.memes})), v => fmtN(v)) + `<h4 class="h4">Сколько реакций в среднем собирает одна картинка, видео или гифка</h4>` + bars(people.filter(x => x.p.memes >= 5).map(({p, i}) => ({i, v:p.memeAvg})), v => fmtD(v)), '', 'Мемом здесь считается любая картинка, видео или гифка, включая пересланные. Во втором списке только те, у кого их хотя бы пять.')}
    ${panel('Реакции', `<h4 class="h4">Сколько реакций в среднем собирает одно сообщение</h4>` + bars(people.map(({p, i}) => ({i, v:p.reactionsPerMsg})), v => fmtD(v)) + `<h4 class="h4">Самые частые реакции в чате</h4><p class="sub">Число — сколько раз реакцию поставили</p>${chips(st.reactionEmoji, 'emo')}`)}
    ${panel('Из чего состоит чат', `<p class="sub">Доля каждого типа среди всех сообщений чата, а ниже — то же для каждого участника. Наведи на полоску, чтобы увидеть числа.</p>${mixRow(st.media, st.total)}<div class="mix-legend">${usedMedia.map(([k, l, c]) => `<span><i style="background:var(${c})"></i>${l}<b>${fmtD(st.media[k] / st.total * 100, 1)}%</b></span>`).join('')}</div>
      <div class="ph">${people.map(({p, i}) => `<div class="hrow"><span class="hl">${who(i)}</span>${mixRow(p.media, p.n)}</div>`).join('')}</div>`)}
    ${panel('Слова и эмодзи компании', `<p class="sub">Число — сколько раз встретилось во всём чате</p><h4 class="h4">Частые слова</h4>${chips(st.words.slice(0, 24))}<h4 class="h4">Эмодзи в тексте сообщений</h4>${chips(st.groupEmoji, 'emo')}`)}
    ${panel('Словечки и эмодзи каждого', `<div class="pw">${people.map(({p, i}) => `<div class="pw-row"><span class="hl">${who(i)}</span><div>${chips(p.words.slice(0, 4))}${chips(p.emoji.slice(0, 3), 'emo')}</div></div>`).join('')}</div>`, 'span-2', 'Словечки — слова, которые человек пишет заметно чаще остальных, а не просто его самые частые. Дальше его самые частые эмодзи. Число — сколько раз.')}
    ${panel('Все цифры по участникам', table, 'span-all')}
  `;
  $('out').value = JSON.stringify(buildGroupGenome(S.st, S.bId, S.names, roles));
  $('copyStatus').textContent = '';
}

bindCopy();
bindIntake({load: data => load(data, false), summary: () => `${fmtN(S.st.total)} сообщений`});

load(makeGroupSample(), true);
