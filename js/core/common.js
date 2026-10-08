/* Shared analysis helpers for Telegram exports (no DOM): stemming, word/emoji scans, message classification. */
const STOP_WORDS = `и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это тебе тобой мной мною нам вами ими свой своя свои своих твой твоя твои твое твоем наш наша наши ваш ваша который которая которые которых просто очень типа короче вообще кстати ладно давай давайте сегодня завтра вчера щас ага угу неа окей ок норм нормально привет пока спасибо пожалуйста блин вроде прям прямо чет чето ваще такое такая такие этих этим эта эти тоже нужно знаю думаю хочу могу можешь будешь буду сделать делать сказал сказала говорит говорю мог могла хотел хотела было будут всё еще ещё либо пусть кажется точно вообщем вобщем нету есть какие какой каких какое тебя тебе мне меня the and you for that this with are was not but have just what its i'm dont don't yes okay lol`.split(/\s+/);

const RV = /^(.*?[аеиоуыэюя])(.*)$/;
const PG = /((ив|ивши|ившись|ыв|ывши|ывшись)|((?<=[ая])(в|вши|вшись)))$/;
const REF = /(с[яь])$/;
const ADJ = /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
const PART = /((ивш|ывш|ующ)|((?<=[ая])(ем|нн|вш|ющ|щ)))$/;
const VERB = /((ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)|((?<=[ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)))$/;
const NOUN = /(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
const DER = /[^аеиоуыэюя][аеиоуыэюя]+[^аеиоуыэюя]+[аеиоуыэюя].*(?<=о)сть?$/;

// Russian Porter stemmer
function stem(w){
  const m = RV.exec(w); if(!m) return w;
  const pre = m[1]; let rv = m[2], t;
  t = rv.replace(PG, '');
  if(t === rv){
    rv = rv.replace(REF, '');
    t = rv.replace(ADJ, '');
    if(t !== rv){ rv = t.replace(PART, ''); }
    else { t = rv.replace(VERB, ''); rv = (t === rv) ? rv.replace(NOUN, '') : t; }
  } else rv = t;
  rv = rv.replace(/и$/, '');
  if(DER.test(rv)) rv = rv.replace(/ость?$/, '');
  t = rv.replace(/ь$/, '');
  if(t !== rv) rv = t; else { rv = rv.replace(/ейше?$/, ''); rv = rv.replace(/нн$/, 'н'); }
  return pre + rv;
}
const isCyr = w => /[а-я]/.test(w);
const keyOf = w => isCyr(w) ? stem(w) : w;
const STOP = new Set(STOP_WORDS.map(w => w.replace(/ё/g, 'е')));
const STOP_KEYS = new Set([...STOP].filter(w => w.length >= 3).map(keyOf));

const URL_RE = /https?:\/\/\S+|www\.\S+/g;
const LAUGH = /^(а?(х+а+)+х*|(х+е+)+х*|(х+и+)+х*)$/;
const PICTO = /\p{Extended_Pictographic}/u;
const SEG = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('ru', {granularity:'grapheme'}) : null;

function textOf(m){
  const t = m.text;
  if(typeof t === 'string') return t;
  if(!Array.isArray(t)) return '';
  return t.map(x => typeof x === 'string' ? x
    : (['link','mention','email','phone','bot_command','code','pre'].includes(x.type) ? ' ' : (x.text || ''))).join('');
}
function classify(m){
  switch(m.media_type){
    case 'sticker': return 'sticker';
    case 'voice_message': return 'voice';
    case 'video_message': return 'videoNote';
    case 'animation': return 'gif';
    case 'video_file': return 'video';
    case 'audio_file': return 'audio';
  }
  if(m.photo) return 'photo';
  if(m.file || m.media_type) return 'file';
  if(m.poll || m.location_information || m.contact_information || m.place_name) return 'other';
  return 'text';
}
function bump(map, key, display){ const v = map.get(key); if(v) v.n++; else map.set(key, {n:1, d:display}); }
const normE = e => e.replace(/️/g, '');
function emojiScan(t, map){
  if(!PICTO.test(t)) return;
  if(SEG){ for(const {segment:g} of SEG.segment(t)) if(PICTO.test(g)) bump(map, normE(g), g); }
  else { for(const g of t.match(/\p{Extended_Pictographic}/gu) || []) bump(map, normE(g), g); }
}
function wordScan(t, words, nameKeys){
  const ms = t.toLowerCase().replace(URL_RE, ' ').replace(/@\w+/g, ' ').match(/[a-zа-яё]+/g);
  if(!ms) return;
  for(let w of ms){
    w = w.replace(/ё/g, 'е');
    if(w.length < 3) continue;
    let k;
    if(LAUGH.test(w)){ w = 'ахах'; k = 'ахах'; }
    else { if(STOP.has(w)) continue; k = keyOf(w); }
    if(k.length < 2 || STOP_KEYS.has(k) || nameKeys.has(k)) continue;
    let v = words.get(k);
    if(!v){ v = {n:0, forms:new Map()}; words.set(k, v); }
    v.n++; v.forms.set(w, (v.forms.get(w) || 0) + 1);
  }
}
function median(a){ if(!a.length) return 0; const s = Float64Array.from(a).sort(); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h-1] + s[h]) / 2; }
const r2 = x => Math.round(x * 100) / 100;
const r1 = x => Math.round(x * 10) / 10;
function topList(map, k){ return [...map.entries()].sort((a,b) => b[1].n - a[1].n).slice(0, k).map(([key, v]) => ({key, d:v.d, n:v.n})); }

class ChatError extends Error { constructor(code){ super(code); this.code = code; } }

const authorId = m => m.from_id || ('name:' + (m.from || '?'));
