# F01 — Fundação Angular — Infra Monitor

Você está iniciando do zero o frontend Angular do projeto **Infra Monitor**.

## Objetivo desta etapa

Criar apenas a **fundação técnica do frontend Angular**, preparando o projeto para que as próximas etapas implementem fielmente o design já aprovado no Claude Design e consumam o backend Spring Boot existente.

**NÃO implemente ainda o Dashboard completo, CRUDs, mapa, incidentes, relatórios ou telas administrativas.**

Esta etapa deve entregar uma base Angular limpa, moderna, testável e pronta para evolução incremental.

---

# 1. Contexto do sistema

Infra Monitor é uma aplicação interna de monitoramento de infraestrutura.

Domínio principal:

```text
Unidade
   ↓
Equipamento ← TipoEquipamento
   ↓
Monitor
   ↓
Medição
   ↓
Incidente
   ↓
Notificação
```

Responsabilidades:

```text
Backend:
- regras de negócio
- persistência
- monitoramento
- thresholds
- incidentes
- notificações
- status operacional

Frontend:
- apresentação
- navegação
- interação
- formulários
- filtros
- feedback visual
```

Regra crítica:

**O Angular nunca deve recalcular status operacional.**

Estados como disponibilidade, indisponibilidade, degradação ou ausência de dados vêm da API de Dashboard.

---

# 2. Material visual existente

Existe um protótipo aprovado produzido no Claude Design.

Arquivos de referência podem incluir:

```text
Infra Monitor.dc.html
sergipe-map.html
github.md
```

e arquivos GeoJSON relacionados ao mapa de Sergipe.

Esse material é a **fonte de verdade visual** para etapas posteriores.

Nesta F01:

* analise o protótipo;
* identifique seus padrões;
* não copie a lógica React/mock;
* não tente converter o HTML diretamente para Angular;
* não implemente ainda todas as telas.

O objetivo é preparar a arquitetura para receber esse design posteriormente.

---

# 3. Criar o projeto Angular

Não existe projeto Angular anterior.

Antes de criar:

1. verifique a versão instalada de Node.js;
2. verifique npm;
3. consulte/utilize uma versão estável atual do Angular CLI;
4. registre no resumo final as versões efetivamente utilizadas.

Crie o projeto Angular chamado, preferencialmente:

```text
infra-monitor-frontend
```

Use os padrões modernos da versão Angular escolhida.

Preferências:

* standalone components;
* Angular Router;
* TypeScript strict;
* SCSS;
* sem SSR, salvo necessidade concreta identificada;
* sem NgModules desnecessários;
* sem state manager externo.

Não adicionar:

```text
NgRx
Redux
Akita
Angular Material
PrimeNG
Tailwind
Bootstrap
```

nesta etapa.

A escolha de biblioteca visual será feita somente depois da análise aprofundada do design.

---

# 4. Estrutura arquitetural inicial

Organize o projeto por responsabilidade e feature, mas **não crie dezenas de pastas vazias**.

Uma referência conceitual é:

```text
src/app/

├── core/
│   ├── api/
│   ├── config/
│   ├── interceptors/
│   └── models/
│
├── shared/
│   ├── models/
│   └── utils/
│
└── features/
```

Adapte conforme os padrões reais da versão Angular utilizada.

Nesta F01, crie somente diretórios que realmente tenham arquivos úteis.

Não implementar abstrações prematuras como:

```text
GenericApiService<T>
BaseCrudService
BaseCrudComponent
GenericForm<T>
UniversalTableComponent
```

---

# 5. Configuração da API

A API utiliza:

```text
http://<host>:<porta>/api/v1
```

Em desenvolvimento, considerar inicialmente:

```text
http://localhost:8080/api/v1
```

A URL deve ficar centralizada.

Não espalhar URL de backend em services.

Utilizar a estratégia de environment/configuração adequada à versão Angular utilizada.

Exemplo conceitual:

```ts
apiUrl: 'http://localhost:8080/api/v1'
```

Não colocar secrets no frontend.

---

# 6. HttpClient

Configure o `HttpClient` usando a abordagem moderna disponível na versão Angular escolhida.

Preferir providers funcionais.

Deixe a aplicação pronta para adicionar interceptors.

Não usar APIs Angular marcadas como deprecated quando existir alternativa atual.

---

# 7. Contrato público de paginação

Criar interface genérica equivalente a:

```ts
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}
```

O backend usa:

```text
page zero-based
size default = 20
medicoes default = 50
size máximo = 100
```

Não modelar estruturas internas do Spring Data.

---

# 8. Modelo de erro da API

Criar um modelo TypeScript correspondente ao contrato:

```json
{
  "timestamp": "2026-08-19T12:00:00Z",
  "status": 400,
  "error": "Bad Request",
  "code": "VALIDATION_ERROR",
  "message": "Requisicao invalida",
  "path": "/api/v1/equipamentos",
  "fields": {
    "nome": "must not be blank"
  }
}
```

Algo equivalente a:

```ts
export interface ApiError {
  timestamp: string;
  status: number;
  error: string;
  code: ApiErrorCode;
  message: string;
  path: string;
  fields?: Record<string, string>;
}
```

Criar tipo explícito para os códigos atualmente documentados:

```text
VALIDATION_ERROR
INVALID_ENUM
MALFORMED_REQUEST
INVALID_PARAMETER
INVALID_REQUEST
RESOURCE_NOT_FOUND
BUSINESS_CONFLICT
DATA_INTEGRITY_VIOLATION
INTERNAL_ERROR
```

Não identificar erros comparando texto de `message`.

---

# 9. Interceptor de erro

Criar a infraestrutura de interceptor HTTP global.

Objetivo nesta etapa:

* reconhecer respostas HTTP de erro;
* preservar o payload original da API;
* transformá-lo/normalizá-lo apenas se necessário;
* não perder `fields`;
* não engolir o erro;
* permitir que páginas/formulários tratem erros específicos;
* evitar `alert()`.

Não criar ainda sistema visual completo de toast.

Se precisar de um serviço simples de tratamento/notificação, mantenha-o mínimo e desacoplado da futura biblioteca visual.

Não transformar toda exceção em mensagem genérica.

Especialmente preservar:

```text
400
404
409
500
```

e o respectivo:

```text
code
message
fields
```

---

# 10. Models de enums compartilhados

Criar tipos/enums TypeScript somente para os contratos públicos já confirmados.

## Monitor

```text
ICMP
```

## Medição

```text
SUCESSO
FALHA
```

## Incidente

```text
ABERTO
FECHADO
```

## Notificação

Canal:

```text
TELEGRAM
```

Evento:

```text
INCIDENTE_ABERTO
INCIDENTE_FECHADO
```

Status:

```text
PENDENTE
ENVIANDO
ENVIADA
FALHA
```

## Status operacional de Monitor

```text
DISPONIVEL
INDISPONIVEL
SEM_DADOS
DESABILITADO
```

## Status operacional de Equipamento

Deve suportar os valores documentados no contrato, incluindo:

```text
DISPONIVEL
INDISPONIVEL
SEM_DADOS
DESABILITADO
SEM_MONITORAMENTO
```

Não inventar outros valores.

## Status operacional de Unidade

Deve suportar os valores documentados, incluindo:

```text
DISPONIVEL
INDISPONIVEL
DEGRADADA
SEM_DADOS
SEM_EQUIPAMENTOS
```

Se o contrato/backend possuir valor adicional, confirmar pelo código/documentação antes de adicioná-lo.

---

# 11. Regra crítica de status

Não criar funções como:

```ts
calculateEquipmentStatus()
resolveOperationalStatus()
isOfflineFromLastMeasurement()
calculateAvailability()
```

baseadas em:

```text
última medição
latência
threshold
falhas consecutivas
```

O backend já faz isso.

É permitido futuramente criar funções puramente visuais como:

```ts
statusLabel(status)
statusIcon(status)
```

mas elas só podem mapear o valor recebido.

---

# 12. Datas

Todos os instantes chegam como ISO-8601 UTC.

Exemplo:

```text
2026-08-19T12:00:00Z
```

Nos models de API, preferir manter o contrato como:

```ts
string
```

quando representar timestamps recebidos diretamente.

Não alterar timezone ou instante nos services.

Conversão/formatação deve ocorrer somente na camada de apresentação.

Não criar parsing automático global desnecessário.

---

# 13. Nullability

TypeScript deve refletir corretamente campos que podem ser `null`.

Exemplo futuro:

```ts
encerradoEm: string | null;
ultimaMedicao: ... | null;
```

Não converter ausência de valor arbitrariamente para:

```text
false
0
''
{}
```

Coleções vazias permanecem arrays vazios.

---

# 14. Query params compartilhados

Criar somente helpers realmente necessários para evitar repetição clara.

Pode existir, por exemplo, um tipo básico:

```ts
PageQuery
```

com:

```text
page?
size?
sort?
```

Não construir neste momento um framework genérico de filtros.

---

# 15. Rotas iniciais

Configure Angular Router.

Por enquanto, não criar todas as telas.

Pode existir uma rota raiz temporária simples que confirme a inicialização.

Prepare o projeto para futuramente receber aproximadamente:

```text
/dashboard
/mapa
/unidades
/unidades/:id
/equipamentos
/equipamentos/:id
/tipos-equipamento
/monitores
/medicoes
/incidentes
/incidentes/:id
/notificacoes
```

Não implementar ainda:

```text
/login funcional
/usuarios
/manutencoes
/auditoria
/configuracoes
/relatorios completos
```

Essas features ainda não possuem todo o backend necessário.

Não criar autenticação fake.

---

# 16. Features futuras e lazy loading

Estruture o router de modo compatível com lazy loading por feature quando elas forem implementadas.

Não criar todos os componentes fake agora apenas para preencher as rotas.

---

# 17. Models de domínio

Nesta F01, não é necessário implementar todos os DTOs completos de todas as entidades se isso gerar código sem uso.

Entretanto, crie os contratos compartilhados fundamentais:

```text
PageResponse<T>
ApiError
ApiErrorCode
enums públicos
tipos de paginação
```

Se criar DTOs de domínio, eles devem vir estritamente do contrato real.

Não inventar campos provenientes dos mocks do Claude Design.

Campos do protótipo como:

```text
mac
serial
patrimonio
lossPercent
severity
maintenance
acknowledged
```

não devem entrar nos modelos apenas porque aparecem visualmente.

---

# 18. Separação entre design e API

O protótipo Claude Design pode possuir estados como:

```text
ONLINE
OFFLINE
DEGRADADO
MANUTENÇÃO
```

Não usar esses valores como contrato da API.

Os valores reais são os enums retornados pelo backend.

Posteriormente poderá existir uma camada visual:

```text
DISPONIVEL -> "Disponível"
INDISPONIVEL -> "Indisponível"
SEM_DADOS -> "Sem dados"
```

sem modificar o valor de domínio.

---

# 19. Autenticação

Autenticação ainda não existe no backend.

Portanto:

NÃO criar:

```text
JWT
AuthService fake
fake login
route guard fake
localStorage de usuário
localStorage de token
interceptor Authorization
```

A tela de login presente no design será implementada somente quando a autenticação for definida.

---

# 20. Telegram

Nenhum segredo do Telegram pode existir no Angular.

Não criar:

```text
BOT_TOKEN
Telegram API client
chamada direta para api.telegram.org
```

Fluxo permitido:

```text
Angular
   ↓
Backend
   ↓
Telegram
```

O frontend futuramente verá apenas histórico/estado de notificações fornecido pelo backend.

---

# 21. Testes

Use a infraestrutura de testes criada oficialmente pela versão Angular escolhida.

Adicionar testes úteis para a fundação, especialmente:

1. `PageResponse`/tipos quando aplicável;
2. comportamento do interceptor de erro;
3. preservação de `ApiError.fields`;
4. tratamento de um erro `409`;
5. configuração básica de um request HTTP em teste, se houver service/helper correspondente.

Não criar testes triviais apenas para aumentar quantidade.

---

# 22. Qualidade

Manter:

* TypeScript strict;
* sem `any` salvo caso realmente justificado;
* nomes claros;
* imports organizados;
* APIs não deprecated;
* responsabilidade única;
* zero secrets;
* zero lógica de negócio duplicada do backend.

Não desativar verificações do TypeScript para fazer build passar.

---

# 23. README

Criar ou atualizar README do frontend contendo pelo menos:

```text
Infra Monitor Frontend
pré-requisitos
versão Node utilizada
versão Angular utilizada
instalação
npm install
como executar
URL frontend
configuração apiUrl
como executar testes
como executar build
estrutura inicial
```

Não documentar comandos que não funcionem.

---

# 24. Verificação obrigatória

Ao terminar:

1. examine `package.json`;
2. execute os scripts reais disponíveis;
3. execute build;
4. execute testes;
5. corrija erros encontrados;
6. não encerre a tarefa com build quebrado.

Não usar comandos destrutivos de Git como:

```text
git reset --hard
git clean -fd
git checkout .
```

---

# 25. Não fazer nesta etapa

Não implementar ainda:

* Dashboard real;
* Sidebar final;
* Design System completo;
* mapa de Sergipe;
* CRUD de Unidade;
* CRUD de Equipamento;
* CRUD de TipoEquipamento;
* Monitoramento;
* Medições;
* Incidentes;
* Notificações;
* Relatórios;
* Usuários;
* login;
* JWT;
* janelas de manutenção;
* auditoria;
* configurações;
* integração Telegram direta;
* polling;
* WebSocket;
* SSE;
* NgRx;
* biblioteca de UI sem análise.

---

# 26. Critérios de aceite da F01

A etapa só está concluída se:

* projeto Angular estiver criado do zero;
* standalone estiver sendo utilizado;
* routing estiver configurado;
* SCSS estiver configurado;
* TypeScript strict estiver ativo;
* API URL estiver centralizada;
* HttpClient estiver configurado;
* modelo `PageResponse<T>` existir;
* modelo `ApiError` existir;
* códigos de erro estiverem tipados;
* enums públicos principais estiverem tipados;
* interceptor HTTP estiver estruturado;
* `fields` de validação não for perdido;
* não houver autenticação fake;
* não houver lógica de status operacional;
* não houver dependência visual desnecessária;
* build passar;
* testes passarem;
* README estiver atualizado.

---

# 27. Entrega final

Ao terminar, responda com um relatório objetivo contendo:

## Resumo

O que foi implementado.

## Estrutura criada

Principais pastas e arquivos.

## Versões

```text
Node:
npm:
Angular:
Angular CLI:
TypeScript:
```

## Decisões arquiteturais

Explique brevemente as decisões relevantes.

## API

Informe onde a `apiUrl` foi centralizada.

## Testes

Informe comandos executados e resultado.

## Build

Informe comando e resultado.

## Pendências

Liste somente o que deliberadamente ficou para a F02 ou posteriores.

## Arquivos alterados

Liste todos os arquivos relevantes criados/alterados.

Não avance automaticamente para a F02.
