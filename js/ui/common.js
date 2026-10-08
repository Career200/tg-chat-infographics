/* Presentation helpers shared by every page: formatting, error texts, file intake, copy button. Needs nav.js. */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtN = n => Math.round(n).toLocaleString('ru-RU');
const fmtMonth = (ym, month = 'short') => { if(!ym) return '—'; const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('ru-RU', {month, year:'numeric', timeZone:'UTC'}).replace(/\s?г\.?$/, ''); };
const plural = (n, one, few, many) => { const t = n % 100, u = n % 10;
  return (t > 10 && t < 20) ? many : u === 1 ? one : (u >= 2 && u <= 4) ? few : many; };
const WD = ['пн','вт','ср','чт','пт','сб','вс'];

// Trusted HTML; pages add their own codes with Object.assign(ERRORS, {...})
const ERRORS = {
  format:'Это не похоже на выгрузку чата. При экспорте выбери формат «Машиночитаемый JSON» и загрузи файл result.json.',
  parse:'Не получилось прочитать файл как JSON. При экспорте выбери формат «Машиночитаемый JSON», а не HTML.'
};

const DROP_IDLE = 'Файл читается только на этом компьютере';

// Wires the drop zone + file input. `load(data)` parses and renders (may throw ChatError);
// `summary()` returns the status line shown after a successful load; `onLoaded()` is optional.
function bindIntake({load, summary, onLoaded}){
  async function handleFile(file){
    const err = $('err'); err.hidden = true;
    if(!file) return;
    $('dropStatus').textContent = `Читаю ${file.name}…`;
    await new Promise(r => setTimeout(r, 30));
    let data;
    try { data = JSON.parse(await file.text()); }
    catch(_){ err.innerHTML = ERRORS.parse; err.hidden = false; $('dropStatus').textContent = DROP_IDLE; return; }
    try {
      load(data);
      $('dropStatus').textContent = `Загружено: ${file.name}, ${summary()}`;
      if(onLoaded) onLoaded();
    } catch(e){
      err.innerHTML = ERRORS[e.code] || esc('Что-то пошло не так: ' + e.message);
      err.hidden = false;
      $('dropStatus').textContent = DROP_IDLE;
    }
  }
  $('file').addEventListener('change', e => handleFile(e.target.files[0]));
  const drop = $('drop');
  ['dragenter','dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
}

// Copies #out to the clipboard; falls back to selecting the text.
function bindCopy(){
  $('copy').addEventListener('click', () => {
    const v = $('out').value;
    const fallback = () => { $('out').focus(); $('out').select(); $('copyStatus').textContent = 'Текст выделен, нажми Ctrl+C или ⌘C'; };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(v).then(() => { $('copyStatus').textContent = 'Скопировано'; }, fallback);
    } else fallback();
  });
}
