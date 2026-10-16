// Rajada de chamadas simultaneas contra a API + amostragem de pg_stat_activity.
// Criado para a DV17 (Docs/validacao-producao/dv17-500-sob-concorrencia.md). Node 18+, sem dependencia.
// Uso: SENHA=... node tools/rajada-api/rajada.cjs <rotulo> <total> <caminho1> [caminho2 ...]
//   caminho pode conter {id}, trocado em rodizio pelos ids de /dashboard/unidades.
//   Ex.: SENHA=... node tools/rajada-api/rajada.cjs dv17 121 "/dashboard/unidades/{id}/equipamentos?size=200&sort=nome"
//   No Git Bash, exporte MSYS_NO_PATHCONV=1: sem isso um caminho que comeca com "/" vira caminho do
//   Windows e toda chamada da 404.
// A amostragem do pool roda `docker exec` em laco (~150 ms por amostra): chamada que termina mais
// rapido que isso pode nao aparecer em `pg.maxEmUso`.
// Env: API (default http://localhost:8080/api/v1), PG_CONTAINER (default inframonitor-postgres),
//      PG_DB (default inframonitor), EMAIL, SENHA.
const { execFile } = require('node:child_process');

const API = process.env.API || 'http://localhost:8080/api/v1';
const PG_CONTAINER = process.env.PG_CONTAINER || 'inframonitor-postgres';
const PG_DB = process.env.PG_DB || 'inframonitor';
const EMAIL = process.env.EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.SENHA;
const [rotulo, totalTxt, ...caminhos] = process.argv.slice(2);
const total = Number(totalTxt);
if (!SENHA || !rotulo || !total || caminhos.length === 0) {
  console.error('uso: SENHA=... node rajada.cjs <rotulo> <total> <caminho...>');
  process.exit(2);
}

const SQL = `select count(*) filter (where state <> 'idle') as em_uso, count(*) as abertas
  from pg_stat_activity where datname = '${PG_DB}' and backend_type = 'client backend'
  and pid <> pg_backend_pid()`;

function amostrar() {
  return new Promise((resolve) => {
    execFile('docker', ['exec', PG_CONTAINER, 'psql', '-U', 'inframonitor', '-d', PG_DB, '-At', '-F', ',', '-c', SQL],
      (err, out) => {
        if (err) return resolve(null);
        const [emUso, abertas] = out.trim().split(',').map(Number);
        resolve({ emUso, abertas });
      });
  });
}

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, senha: SENHA, password: SENHA }),
  });
  if (!login.ok) throw new Error(`login ${login.status}: ${await login.text()}`);
  const corpoLogin = await login.json();
  const token = corpoLogin.accessToken || corpoLogin.token || corpoLogin.access_token;
  if (!token) throw new Error(`login sem token: ${Object.keys(corpoLogin)}`);
  const auth = { Authorization: `Bearer ${token}` };

  const unidades = await (await fetch(`${API}/dashboard/unidades`, { headers: auth })).json();
  const ids = unidades.map((u) => u.id);

  const urls = Array.from({ length: total }, (_, i) => {
    const c = caminhos[i % caminhos.length];
    return `${API}${c.replace('{id}', ids[i % ids.length])}`;
  });

  let ativo = true;
  const amostras = [];
  const amostragem = (async () => {
    while (ativo) { const a = await amostrar(); if (a) amostras.push(a); }
  })();
  await new Promise((r) => setTimeout(r, 300));

  const t0 = Date.now();
  const resultados = await Promise.all(urls.map(async (url) => {
    const t = Date.now();
    try {
      const r = await fetch(url, { headers: auth });
      const corpo = await r.text();
      return { url, status: r.status, ms: Date.now() - t, corpo: r.status >= 500 ? corpo.slice(0, 300) : '' };
    } catch (e) {
      return { url, status: 'ERRO_REDE', ms: Date.now() - t, corpo: String(e) };
    }
  }));
  const dur = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 300));
  ativo = false;
  await amostragem;

  const porStatus = {};
  for (const r of resultados) porStatus[r.status] = (porStatus[r.status] || 0) + 1;
  const porCaminho = {};
  for (const r of resultados) {
    const chave = r.url.replace(API, '').replace(/\/unidades\/\d+/, '/unidades/{id}');
    porCaminho[chave] ??= {};
    porCaminho[chave][r.status] = (porCaminho[chave][r.status] || 0) + 1;
  }
  const ms = resultados.map((r) => r.ms).sort((a, b) => a - b);
  const maxEmUso = Math.max(0, ...amostras.map((a) => a.emUso));
  const maxAbertas = Math.max(0, ...amostras.map((a) => a.abertas));
  console.log(JSON.stringify({
    rotulo, total, duracaoMs: dur, porStatus, porCaminho,
    latenciaMs: { p50: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1] },
    pg: { amostras: amostras.length, maxEmUso, maxAbertas },
    exemplo500: resultados.find((r) => r.status >= 500)?.corpo || null,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
