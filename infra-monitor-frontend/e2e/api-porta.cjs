/* Aponta o frontend do `ng serve` para outro backend, sem tocar no código nem derrubar o backend de dev:
 * a requisição é refeita pelo Playwright na porta pedida (preserva método, headers e corpo).
 * Com o proxy de dev (proxy.conf.mjs) o navegador chama a API na origem do front (`base`/api/**), não
 * mais em localhost:8080; as duas rotas são interceptadas. `base` é a origem do front. */
async function apontarApi(ctx, base = process.env.E2E_BASE || 'http://localhost:4200') {
  const porta = process.env.API_PORT || '8080';
  if (porta === '8080') return porta;
  await ctx.route('http://localhost:8080/**', async (route) => {
    const url = route.request().url().replace('localhost:8080', `localhost:${porta}`);
    const resposta = await route.fetch({ url });
    await route.fulfill({ response: resposta });
  });
  const origem = new URL(base).origin;
  await ctx.route(`${origem}/api/**`, async (route) => {
    const original = new URL(route.request().url());
    const url = `http://localhost:${porta}${original.pathname}${original.search}`;
    const resposta = await route.fetch({ url });
    await route.fulfill({ response: resposta });
  });
  return porta;
}
module.exports = { apontarApi };
