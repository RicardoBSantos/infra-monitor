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
apiUrl: 'http://localhost:8080/api/v1'
```

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
