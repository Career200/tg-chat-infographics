/* Page registry + top bar. To add a page: add an entry here, nothing else. Links are relative so GitHub Pages subpaths work. */
const PAGES = [
  {id:'personal', href:'index.html', title:'Геном общения', sub:'личный чат'},
  {id:'group', href:'group.html', title:'Геном компании', sub:'группа'}
];
const pageLink = (id, text) => { const p = PAGES.find(x => x.id === id); return `<a href="${p.href}">${text || p.title}</a>`; };

(function renderNav(){
  const nav = document.getElementById('nav'); if(!nav) return;
  const here = (location.pathname.split('/').pop() || 'index.html');
  nav.innerHTML = `<ul>${PAGES.map(p => `<li><a href="${p.href}"${p.href === here ? ' aria-current="page"' : ''}>${p.title}<small>${p.sub}</small></a></li>`).join('')}</ul>`;
})();
