/* Dev na mesma origem, como produção (IIS/ARR): o `ng serve` repassa /api ao backend. Assim o cookie
 * httpOnly do refresh (Path=/api/v1/auth, SameSite=Strict) funciona sem afrouxar o CORS.
 * `changeOrigin: false` mantém o Host igual ao Origin: o Spring não trata a chamada como CORS.
 * Outro backend: `API_PORT=8081 npx ng serve`. */
const porta = process.env.API_PORT ?? '8080';

export default {
  '/api': { target: `http://localhost:${porta}`, changeOrigin: false, secure: false },
};
