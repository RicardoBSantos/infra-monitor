/* Aponta o frontend do `ng serve` (apiUrl cravado em localhost:8080) para outro backend, sem tocar
 * no código nem derrubar o backend de dev: a requisição é refeita pelo Playwright na porta pedida. */
async function apontarApi(ctx) {
  const porta = process.env.API_PORT || '8080';
  if (porta === '8080') return porta;
  await ctx.route('http://localhost:8080/**', async (route) => {
    const url = route.request().url().replace('localhost:8080', `localhost:${porta}`);
    const resposta = await route.fetch({ url });
    await route.fulfill({ response: resposta });
  });
  return porta;
}
module.exports = { apontarApi };
