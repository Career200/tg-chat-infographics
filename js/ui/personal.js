/* Personal-chat page: state, rendering, events. Needs core/common.js, core/personal.js, ui/common.js. */
const MEDIA = [['text','Текст','--m-text'],['photo','Фото','--m-photo'],['voice','Голосовые','--m-voice'],['videoNote','Кружки','--m-vnote'],
  ['sticker','Стикеры','--m-sticker'],['gif','Гифки','--m-gif'],['video','Видео','--m-video'],['audio','Аудио','--m-other'],['file','Файлы','--m-other'],['other','Другое','--m-other']];
Object.assign(ERRORS, {
  full:'Это выгрузка всего аккаунта. Нужна выгрузка одного чата: открой чат с именинником и экспортируй историю из него.',
  group:'Это групповой чат. Сюда нужен личный чат с именинником. Для групп есть ' + pageLink('group', 'отдельная страница') + '.',
  oneSide:'В выгрузке сообщения только от одного человека. Проверь, что выгружен личный чат с именинником.'
});

let state = null; // {data, info, bId, stats, excl, sample, friendName}
const freshExcl = () => ({ef:new Set(), eb:new Set(), sf:new Set(), sb:new Set(), words:new Set()});

function load(data, sample){
  const info = inspect(data);
  state = {data, info, sample, bId:info.guess, excl:freshExcl()};
  recompute();
}
function recompute(){
  state.stats = compute(state.data, state.bId);
  state.excl = freshExcl();
  state.picked = new Set();
  state.pickShow = PICK_SHOW;
  const fr = state.info.authors.find(a => a.id !== state.bId);
  state.friendName = fr ? fr.name : '';
  if(!state.sample) $('fname').value = state.friendName;
  render();
}

function chipList(listKey, list, title, cls){
  const ex = state.excl[listKey];
  const shown = pick(list, ex);
  const removed = list.filter(x => ex.has(x.key));
  const chips = shown.length
    ? shown.map(x => `<span class="chip"><span class="g">${esc(x.d)}</span><span class="cnt">${fmtN(x.n)}</span><button class="x" type="button" data-l="${listKey}" data-k="${esc(x.key)}" aria-label="Убрать ${esc(x.d)}">×</button></span>`).join('')
    : '<span class="empty">Ничего нет</span>';
  const rem = removed.length ? `<div class="removed">Убрано: ${removed.map(x => `<button class="restore" type="button" data-r="${listKey}" data-k="${esc(x.key)}">${esc(x.d)} ↺</button>`).join('')}</div>` : '';
  return `<div class="side"><div class="side-h"><span class="dot ${cls}"></span>${title}</div><div class="chips">${chips}</div>${rem}</div>`;
}

function wordTop(list){
  const ex = state.excl.words, shown = pick(list, ex), removed = list.filter(x => ex.has(x.key));
  const chips = shown.length
    ? shown.map(x => `<span class="chip"><span>${esc(x.d)}</span><span class="cnt">${fmtN(x.n)}</span><button class="x" type="button" data-l="words" data-k="${esc(x.key)}" aria-label="Убрать ${esc(x.d)}">×</button></span>`).join('')
    : '<span class="empty">Ничего нет</span>';
  const rem = removed.length ? `<div class="removed">Убрано: ${removed.map(x => `<button class="restore" type="button" data-r="words" data-k="${esc(x.key)}">${esc(x.d)} ↺</button>`).join('')}</div>` : '';
  return `<div class="chips">${chips}</div>${rem}`;
}

function wordPicker(list){
  const avail = list.filter(x => !state.excl.words.has(x.key));
  const pool = avail.slice(0, state.pickShow);
  const full = state.picked.size >= PICK_MAX;
  const chips = pool.map(x => { const on = state.picked.has(x.key);
    return `<button class="pick" type="button" data-pick="${esc(x.key)}" aria-pressed="${on}" ${!on && full ? 'disabled' : ''}>${esc(x.d)}<span class="cnt">${fmtN(x.n)}</span></button>`; }).join('');
  return `<div class="chips">${chips || '<span class="empty">Слов не нашлось</span>'}</div>
    <div class="row">
      ${avail.length > pool.length ? `<button class="restore more" type="button" data-more="1">Показать ещё ${Math.min(PICK_SHOW, avail.length - pool.length)}</button>` : ''}
      <span class="status">Выбрано ${state.picked.size} из ${PICK_MAX}${full ? '. Чтобы выбрать другое, сними отметку с одного из слов' : ''}</span>
    </div>`;
}

function memeSide(m, title, cls, who){
  const pct = x => Math.round(x * 100) + '%';
  const head = `<div class="side-h"><span class="dot ${cls}"></span>${title}</div>`;
  if(!m.count) return `<div class="side meme">${head}<span class="empty">Ни одного разговора, начатого с мема</span></div>`;
  const every = memeEvery(m.ofStarts);
  const freq = every === 1 ? `Почти каждый разговор, который ${who}` : `Каждый ${every}-й разговор, который ${who}`;
  const rows = [
    ['continued', 'Ответ, и завязался разговор', cls === 'f' ? '--friend' : '--bday'],
    ['oneReply', 'Один ответ, и тишина', '--m-voice'],
    ['ignored', 'Без ответа', '--m-other']
  ];
  return `<div class="side meme">${head}
    <p class="meme-lead"><span><b>${fmtN(m.count)}</b> ${plural(m.count, 'разговор', 'разговора', 'разговоров')}</span><span class="meme-sub">${freq}</span></p>
    <div class="outcomes">${rows.map(([k, l, c]) => `<div class="oc"><span>${l}</span><b>${pct(m[k])}</b><div class="meter"><span style="width:${m[k] * 100}%;background:var(${c})"></span></div></div>`).join('')}</div>
  </div>`;
}

function gel(arr, cls, labels){
  const max = Math.max(1, ...arr);
  const cells = arr.map((v, i) => `<div class="c" title="${labels[i]}: ${fmtN(v)}" style="background:color-mix(in oklab, var(--accent) ${Math.round(v / max * 100)}%, var(--cell))"></div>`).join('');
  const labs = labels.map(l => `<div class="lab">${l}</div>`).join('');
  return `<div class="gel ${cls}">${cells}${labs}</div>`;
}

function render(){
  const st = state.stats, F = st.sides.friend, B = st.sides.birthday;
  const bName = esc(state.info.authors.find(a => a.id === state.bId).name);
  const fLabel = 'Ты', bLabel = bName;

  $('sampleNote').hidden = !state.sample;
  const who = $('who');
  if(state.sample){ who.hidden = true; }
  else {
    who.hidden = false;
    who.innerHTML = `<fieldset><legend>Кто из вас именинник?</legend>${state.info.authors.map(a =>
      `<label><input type="radio" name="bday" id="bday-${esc(a.id)}" value="${esc(a.id)}" ${a.id === state.bId ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</fieldset>`;
  }

  const kpis = [
    [`${fmtMonth(st.first && st.first.slice(0,7))} — ${fmtMonth(st.last && st.last.slice(0,7))}`, 'период переписки'],
    [fmtN(st.total), 'сообщений'],
    [fmtN(st.activeDays), 'дней, когда переписывались'],
    [fmtN(st.streak), 'дней подряд, рекорд'],
    [fmtN(st.convos), 'разговоров'],
  ];
  if(st.calls) kpis.push([`${fmtN(st.calls)} · ${fmtN(st.callMin)} мин`, 'звонков']);

  const hourLabels = Array.from({length:24}, (_, i) => i % 6 === 0 ? String(i) : '');
  const hourBlock = `<div class="gel h">${st.hours.map((v, i) => `<div class="c" title="${i}:00 — ${fmtN(v)}" style="background:color-mix(in oklab, var(--accent) ${Math.round(v / Math.max(1, ...st.hours) * 100)}%, var(--cell))"></div>`).join('')}${hourLabels.map(l => `<div class="lab">${l}</div>`).join('')}</div>`;

  const mixTotal = st.total || 1;
  const mixParts = MEDIA.filter(([k]) => st.media[k] > 0);
  const mix = mixParts.map(([k, l, c]) => `<span style="width:${st.media[k] / mixTotal * 100}%;background:var(${c})" title="${l}"></span>`).join('');
  const mixLegend = mixParts.map(([k, l, c]) => `<span><i style="background:var(${c})"></i>${l}<b>${(st.media[k] / mixTotal * 100).toFixed(st.media[k] / mixTotal < 0.01 ? 1 : 0)}%</b></span>`).join('');

  const pct = x => Math.round(x * 100) + '%';
  $('report').innerHTML = `
    <div class="kpis">${kpis.map(([v, l]) => `<div class="kpi"><span class="v">${v}</span><span class="l">${l}</span></div>`).join('')}</div>

    <div class="block">
      <h3>Две стороны</h3>
      <div class="strand" role="img" aria-label="Доля сообщений: ты ${pct(F.share)}, ${bLabel} ${pct(B.share)}"><span class="f" style="width:${F.share * 100}%"></span><span class="b" style="width:${B.share * 100}%"></span></div>
      <div class="legend2"><span><span class="dot f"></span>${fLabel} · ${pct(F.share)}</span><span><span class="dot b"></span>${bLabel} · ${pct(B.share)}</span></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th></th><th class="num">${fLabel}</th><th class="num">${bLabel}</th></tr></thead>
        <tbody>
          <tr><td>Сообщений</td><td class="num">${fmtN(F.messages)}</td><td class="num">${fmtN(B.messages)}</td></tr>
          <tr><td>Начинает разговор</td><td class="num">${pct(F.startsConvos)}</td><td class="num">${pct(B.startsConvos)}</td></tr>
          <tr><td>Медианная длина, символов</td><td class="num">${F.medianLen}</td><td class="num">${B.medianLen}</td></tr>
          <tr><td>Медианное время ответа, мин</td><td class="num">${F.medianReplyMin}</td><td class="num">${B.medianReplyMin}</td></tr>
        </tbody></table></div>
    </div>

    <div class="block">
      <h3>Когда вы пишете</h3>
      ${hourBlock}
      ${gel(st.weekdays, 'w', WD)}
      <div class="facts">
        <span>Ночью, с 0 до 6: <b>${pct(st.nightShare)}</b></span>
        <span>Самый активный месяц: <b>${fmtMonth(st.peakMonth)}</b></span>
        <span>Медианный ответ: <b>${st.medianReplyMin} мин</b></span>
      </div>
    </div>

    <div class="block">
      <h3>Из чего состоит переписка</h3>
      <div class="mix">${mix}</div>
      <div class="mix-legend">${mixLegend}</div>
    </div>

    <div class="block">
      <h3>Разговоры, начатые с мема</h3>
      <p class="hint">Первое сообщение разговора — картинка, видео или гифка. Что было дальше?</p>
      <div class="pair">${memeSide(st.memeStarts.friend, fLabel, 'f', 'ты начинаешь')}${memeSide(st.memeStarts.birthday, bLabel, 'b', 'начинает ' + bLabel)}</div>
      <p class="hint">Для сравнения: разговор, начатый с текста, завязывается в <b>${pct(st.textStartsContinued)}</b> случаев.</p>
    </div>

    <div class="block">
      <h3>Эмодзи</h3>
      <div class="pair">${chipList('ef', st.cand.ef, fLabel, 'f')}${chipList('eb', st.cand.eb, bLabel, 'b')}</div>
    </div>

    <div class="block">
      <h3>Стикеры, по их эмодзи</h3>
      <div class="pair">${chipList('sf', st.cand.sf, fLabel, 'f')}${chipList('sb', st.cand.sb, bLabel, 'b')}</div>
    </div>

    <div class="block">
      <h3>Самые частые слова</h3>
      <p class="hint">Эти три попадут в открытку автоматически. Если какое-то не хочется показывать, убери его, и его место займёт следующее.</p>
      ${wordTop(st.cand.words)}
    </div>

    <div class="block">
      <h3>Слова на твой выбор · по желанию</h3>
      <p class="hint">Отметь до ${PICK_MAX} слов, которые кажутся смешными, неожиданными или очень про вас. Число рядом показывает, сколько раз слово встречалось.</p>
      ${wordPicker(st.cand.words)}
    </div>`;

  $('sendLocked').hidden = !state.sample;
  $('sendBox').hidden = state.sample;
  updateOut();
}

function updateOut(){
  if(!state || state.sample) return;
  const name = $('fname').value.trim() || state.friendName;
  $('out').value = JSON.stringify(buildGenome(state.stats, state.excl, name, state.picked));
  $('copyStatus').textContent = '';
}

$('report').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  let refocus = null;
  if(b.dataset.more){ state.pickShow += PICK_SHOW; render(); return; }
  if(b.dataset.pick){ const k = b.dataset.pick; if(state.picked.has(k)) state.picked.delete(k); else if(state.picked.size < PICK_MAX) state.picked.add(k); refocus = k; }
  else if(b.dataset.l){ state.excl[b.dataset.l].add(b.dataset.k); if(b.dataset.l === 'words') state.picked.delete(b.dataset.k); }
  else if(b.dataset.r){ state.excl[b.dataset.r].delete(b.dataset.k); }
  else return;
  render();
  if(refocus){ const el = [...document.querySelectorAll('[data-pick]')].find(x => x.dataset.pick === refocus); if(el) el.focus(); }
});
$('who').addEventListener('change', e => { if(e.target.name === 'bday'){ state.bId = e.target.value; recompute(); } });
$('fname').addEventListener('input', updateOut);

bindCopy();
bindIntake({
  load: data => load(data, false),
  summary: () => `${fmtN(state.stats.total)} сообщений`,
  onLoaded: () => $('s3').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start'})
});

load(makeSample(), true);
