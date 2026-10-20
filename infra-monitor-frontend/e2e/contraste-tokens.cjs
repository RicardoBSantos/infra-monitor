/*
 * Mede contraste WCAG dos tokens de _tokens.scss, nos dois temas.
 *   node e2e/contraste-tokens.cjs [arquivo-saida.md]
 * Exit 1 se: texto < 4,5 sobre qualquer fundo; ordem secondary>muted>faint>dim quebrada;
 * on-primary < 4,5; placeholder do login < 4,5; texto de status < 4,5 sobre o -bg translúcido.
 */
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', '_tokens.scss'), 'utf8');

function bloco(seletor) {
  const i = src.indexOf(seletor + ' {');
  if (i < 0) throw new Error('bloco não encontrado: ' + seletor);
  const corpo = src.slice(src.indexOf('{', i) + 1, src.indexOf('\n}', i));
  const mapa = {};
  for (const m of corpo.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) mapa[m[1].replace(/^im-/, '')] = m[2].trim(); // tokens são --im-*; o script usa o nome sem prefixo
  return mapa;
}
const escuro = bloco(':root');
const claro = { ...escuro, ...bloco(":root[data-theme='light']") };
const loginEscuro = bloco('.login-page');
const loginClaro = { ...loginEscuro, ...bloco(":root[data-theme='light'] .login-page") };

const parse = (v) => {
  if (!v) return null;
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return { rgb: [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16)), a: 1 };
  m = v.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
  return null;
};
const sobre = (frente, fundo) => frente.rgb.map((c, i) => c * frente.a + fundo.rgb[i] * (1 - frente.a));
const lum = (rgb) => { const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const FUNDOS = ['bg', 'surface', 'surface-header', 'surface-raised', 'surface-hover', 'surface-active'];
const TEXTOS = ['text', 'text-strong', 'text-soft', 'text-secondary', 'text-muted', 'text-faint', 'text-dim',
  'link', 'primary', 'success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft', 'danger-strong', 'danger-text', 'info-soft'];
const ORDEM = ['text-secondary', 'text-muted', 'text-faint', 'text-dim'];
const STATUS_SOBRE_BG = [['success', 'success-bg'], ['success', 'success-bg-strong'], ['warning', 'warning-bg'], ['warning', 'warning-bg-strong'],
  ['danger', 'danger-bg'], ['danger', 'danger-bg-strong'], ['text-secondary', 'neutral-bg'], ['text-secondary', 'neutral-bg-strong'], ['link', 'primary-soft']];

const linhas = []; const falhas = [];
const reg = (tema, frente, fundo, r, minimo = 4.5) => { const ok = r >= minimo; linhas.push(`| ${tema} | ${frente} | ${fundo} | ${r.toFixed(2)} | ${ok ? 'ok' : 'FALHA'} |`); if (!ok) falhas.push(`${tema}: ${frente} sobre ${fundo} = ${r.toFixed(2)}`); };

for (const [tema, t, lg] of [['escuro', escuro, loginEscuro], ['claro', claro, loginClaro]]) {
  for (const tx of TEXTOS) for (const f of FUNDOS) {
    const a = parse(t[tx]), b = parse(t[f]);
    if (!a || !b || a.a !== 1 || b.a !== 1) { linhas.push(`| ${tema} | ${tx} | ${f} | — | FALHA: não medível (${t[tx]} / ${t[f]}) |`); falhas.push(`${tema}: ${tx} sobre ${f} não medível (${t[tx]} / ${t[f]})`); continue; }
    reg(tema, tx, f, razao(a.rgb, b.rgb));
  }
  reg(tema, 'on-primary', 'primary', razao(parse(t['on-primary']).rgb, parse(t['primary']).rgb));
  reg(tema, 'lg-placeholder', 'lg-input', razao(parse(lg['lg-placeholder']).rgb, parse(lg['lg-input']).rgb));
  reg(tema, 'lg-muted', 'lg-card', razao(parse(lg['lg-muted']).rgb, parse(lg['lg-card']).rgb));
  for (const [tx, bgTok] of STATUS_SOBRE_BG) {
    const bg = parse(t[bgTok]);
    // "token ausente" não falha por ora: a Task 5 passa a tratá-lo como falha, conforme o plano.
    if (!bg) { linhas.push(`| ${tema} | ${tx} | ${bgTok} | — | token ausente |`); continue; }
    for (const base of ['surface', 'surface-raised']) reg(tema, tx, `${bgTok} sobre ${base}`, razao(parse(t[tx]).rgb, sobre(bg, parse(t[base]))));
  }
  const r = ORDEM.map((k) => razao(parse(t[k]).rgb, parse(t['surface']).rgb));
  const emOrdem = r.every((v, i) => i === 0 || v < r[i - 1]);
  linhas.push(`| ${tema} | ordem ${ORDEM.join(' > ')} | surface | ${r.map((v) => v.toFixed(2)).join(' > ')} | ${emOrdem ? 'ok' : 'FALHA'} |`);
  if (!emOrdem) falhas.push(`${tema}: ordem quebrada ${r.map((v) => v.toFixed(2)).join(', ')}`);
}

const saida = ['| tema | frente | fundo | razão | resultado |', '|---|---|---|---|---|', ...linhas].join('\n');
console.log(saida);
if (process.argv[2]) fs.writeFileSync(process.argv[2], saida + '\n');
if (falhas.length) { console.error('\nFALHAS (' + falhas.length + '):\n' + falhas.join('\n')); process.exit(1); }
console.log('\nOK: todas as combinações ≥ 4,5 e ordem respeitada.');
