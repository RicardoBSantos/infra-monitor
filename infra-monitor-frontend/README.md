# Infra Monitor Frontend

Frontend Angular do Infra Monitor. Esta primeira etapa contém somente a fundação técnica; não inclui dashboard, mapa, CRUDs ou autenticação.

## Pré-requisitos

- Node.js 22.14.0
- npm 11.15.0

O projeto utiliza Angular 21.2.20 e Angular CLI 21.2.21.

## Instalação

```bash
npm install
```

## Executar localmente

```bash
npm start
```

A aplicação fica disponível em `http://localhost:4200`.

## Configuração da API

A URL base de desenvolvimento está centralizada em `src/environments/environment.ts`, na propriedade `apiUrl`:

```ts
apiUrl: '/api/v1'
```

O `ng serve` usa `proxy.conf.mjs`: `/api` é encaminhado para `http://localhost:${API_PORT:-8080}`
com `changeOrigin: false`, então o desenvolvimento é mesma origem, como a produção (IIS/ARR). Para
outro backend, suba o `ng serve` com `API_PORT` (por exemplo `API_PORT=8081 ng serve`). Para acessar
pela LAN use `ng serve --host 0.0.0.0` em vez de uma `apiUrl` absoluta: uma URL `http://` fora de
`localhost` faz o navegador recusar o cookie `Secure` da sessão, e ela volta a durar 15 minutos.

Não coloque segredos no frontend.

## Testes e build

```bash
npm test
npm run build
```

## Estrutura inicial

```text
src/
├── app/
│   ├── core/
│   │   ├── interceptors/  # interceptador global de erros HTTP
│   │   └── models/        # contratos públicos compartilhados
│   ├── app.config.ts      # Router e HttpClient funcionais
│   └── app.routes.ts      # pronto para lazy loading por feature
└── environments/
    └── environment.ts     # configuração centralizada da API
```
