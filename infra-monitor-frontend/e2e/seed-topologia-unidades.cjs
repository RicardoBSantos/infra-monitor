/*
 * Seed da topologia de demonstração: estrela com a Sede Administrativa na raiz e as demais
 * unidades conectadas a ela.
 *
 *   SEED_SENHA=<senha do admin> node e2e/seed-topologia-unidades.cjs
 *
 * Pré-requisito: backend no ar (8080) com o banco de dev. Não precisa do ng serve — não há
 * navegador aqui, o alvo é a API.
 *
 * POR QUE ISTO NÃO É SQL, ao contrário das coordenadas (db/dev-seed/01-unidades-coordenadas.sql):
 *
 * `conecta_a_unidade_id` é auto-referência, e a única constraint do banco é
 * `ck_unidade_conexao_nao_reflexiva`, que barra apenas `id = id`. Um ciclo de dois ou mais saltos
 * (A -> B -> A) passa pelo CHECK sem reclamar e só apareceria muito depois, como recursão infinita
 * em quem percorresse a árvore. `PUT /unidades/{id}/conexao` já detecta ciclo multi-hop desde N04.
 * Gravar direto no banco pularia justamente a validação que existe para este campo.
 *
 * Idempotente: relê o estado antes de escrever e só chama o endpoint para quem ainda não aponta
 * para a raiz. Reexecutar não dispara nenhuma requisição de escrita.
 */
const API = process.env.SEED_API || 'http://localhost:8080/api/v1';
const EMAIL = process.env.SEED_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.SEED_SENHA;
if (!SENHA) throw new Error('SEED_SENHA é obrigatória');

/** Sigla da raiz, não id: id de sequence não é estável entre bancos recriados do zero. */
const SIGLA_RAIZ = 'SED';

const chamar = async (metodo, caminho, token, corpo) => {
  const resposta = await fetch(API + caminho, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  if (!resposta.ok) throw new Error(`${metodo} ${caminho} -> ${resposta.status} ${texto}`);
  return texto ? JSON.parse(texto) : null;
};

(async () => {
  const { accessToken } = await chamar('POST', '/auth/login', null, { email: EMAIL, senha: SENHA });

  const unidades = await chamar('GET', '/unidades', accessToken);
  const raiz = unidades.find((u) => u.sigla.toUpperCase() === SIGLA_RAIZ);
  if (!raiz) throw new Error(`unidade raiz de sigla ${SIGLA_RAIZ} não existe no banco`);

  const alvos = unidades.filter((u) => u.id !== raiz.id);
  console.log(`raiz: #${raiz.id} ${raiz.nome} | ${alvos.length} unidade(s) a conectar`);

  let escritas = 0;
  let jaCorretas = 0;
  for (const unidade of alvos) {
    if (unidade.conectaAUnidadeId === raiz.id) {
      jaCorretas += 1;
      continue;
    }
    await chamar('PUT', `/unidades/${unidade.id}/conexao`, accessToken, { conectaAUnidadeId: raiz.id });
    escritas += 1;
    console.log(`  PUT /unidades/${unidade.id}/conexao  ${unidade.nome} -> ${raiz.nome}`);
  }

  // Confere relendo, e não confiando no 200 de cada PUT: o que interessa é o estado final.
  const depois = await chamar('GET', '/unidades', accessToken);
  const conectadas = depois.filter((u) => u.conectaAUnidadeId === raiz.id).length;
  const raizDepois = depois.find((u) => u.id === raiz.id);

  console.log(`\nescritas: ${escritas} | já corretas: ${jaCorretas}`);
  console.log(`conectadas à raiz: ${conectadas}/${alvos.length}`);
  console.log(`raiz sem pai: ${raizDepois.conectaAUnidadeId === null}`);

  if (conectadas !== alvos.length || raizDepois.conectaAUnidadeId !== null) {
    process.exitCode = 1;
    console.error('\nFALHA: topologia final não é a estrela esperada.');
  }
})().catch((erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
