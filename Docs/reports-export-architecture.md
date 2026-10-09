# R04.1 — Arquitetura e contratos de exportação de relatórios

**Status:** concluído. Especificação normativa para R04.2, R04.3, R04.4 e R04.5.

**Data:** 25/08/2026.

**Escopo desta fase:** somente arquitetura e contratos; nenhum CSV ou PDF foi implementado.

Este documento refina as decisões preliminares de exportação da R01. Em particular, o endpoint V1 passa a terminar em `/export`, o `sort` homologado é preservado e o CSV usa BOM UTF-8 por compatibilidade com o ambiente de planilhas. Havendo conflito sobre exportação, este documento mais recente prevalece.

## 1. Objetivo e decisões executivas

A exportação é gerada integralmente pelo backend, a partir da mesma semântica analítica dos relatórios homologados. O Angular faz uma única requisição autenticada, recebe um `Blob` e salva o arquivo. É proibido ao frontend percorrer páginas, concatenar resultados ou montar CSV.

Entram no CSV V1:

- Disponibilidade por Equipamentos;
- Disponibilidade por Unidades;
- Incidentes;
- Medições;
- Latência ICMP;
- Notificações.

A **Visão Geral não entra no CSV V1**. Ela combina KPIs, rankings e seis consultas com granularidades diferentes; não existe um dataset tabular único que a represente sem criar semântica nova. Ela é candidata a uma apresentação consolidada em PDF na R04.4. CSV continua sendo formato de datasets tabulares e PDF, potencialmente, de apresentação consolidada.

A operação V1 será **síncrona**, em uma requisição HTTP, e terá **streaming** de cursor/projeção explícita até a resposta. Não haverá fila, job, polling nem storage temporário. `StreamingResponseBody`/I/O assíncrono do servlet pode ser uma técnica de implementação, mas não muda a semântica de produto: o usuário aguarda o download da requisição corrente.

## 2. Auditoria do estado homologado

Foram lidos e confrontados `RelatorioController`, `RelatorioService`, `DisponibilidadeSqlRepository`, `PaginaResposta`, os seis DTOs de relatórios, `RelatorioApiService`, seus modelos TypeScript, `SecurityConfiguration`, filtro JWT, handlers 401/403, CORS e os três documentos arquiteturais obrigatórios.

Constatações que vinculam a implementação futura:

- Os seis endpoints atuais são `GET`, recebem `inicio`, `fim`, filtros opcionais, `page`, `size` e um único `sort=campo,direcao`.
- O backend limita páginas a 100 itens, mas isso é paginação visual e não pode limitar o arquivo.
- `RelatorioService` centraliza período, existência/coerência hierárquica e whitelist de sort. IDs inexistentes produzem 404; combinações incoerentes, período e sort inválidos produzem 400.
- Disponibilidade usa a fórmula temporal homologada e, no caminho PostgreSQL, CTEs de `DisponibilidadeSqlRepository`; ela não pode ser recalculada no exportador.
- Incidentes, medições, latência e notificações usam projeções SQL. Latência, inclusive P95, é calculada no PostgreSQL.
- O frontend apenas envia os parâmetros reais e recebe `PageResponse<T>`; não existe exportação hoje.
- `SecurityConfiguration` permite qualquer `GET /api/v1/**` a `ADMIN`, `OPERADOR` e `VISUALIZADOR`. Conta inativa termina em 401; `PASSWORD_CHANGE_REQUIRED` termina em 403 antes do controller.
- O CORS atual aceita `Authorization`, mantém `allowCredentials(false)`, mas ainda não expõe `Content-Disposition`.
- R02.5 mediu, em PostgreSQL 16, 150.500 medições, 6.000 incidentes e 6.000 notificações. Os endpoints paginados ficaram adequados ao MVP, sem N+1 ou spill. Essa evidência não é benchmark de CSV.
- O DTO real de medição não contém `mensagem`, apesar de uma menção antiga na arquitetura R01. Portanto essa coluna não faz parte do CSV.
- O DTO de notificação contém `erro`, mas esse campo é deliberadamente excluído do contrato de exportação: ele pode representar detalhe de integração/implementação e aumenta o risco de expor exceção interna, stack trace ou segredo legado.

Não é necessário subir backend ou frontend para esta fase: os contratos puderam ser validados integralmente por inspeção estática, e não há endpoint de exportação a validar em execução.

## 3. Contrato HTTP

### 3.1 Endpoints e método

| Relatório | Endpoint V1 | Método |
|---|---|---|
| Disponibilidade Equipamentos | `/api/v1/relatorios/disponibilidade/equipamentos/export` | `GET` |
| Disponibilidade Unidades | `/api/v1/relatorios/disponibilidade/unidades/export` | `GET` |
| Incidentes | `/api/v1/relatorios/incidentes/export` | `GET` |
| Medições | `/api/v1/relatorios/medicoes/export` | `GET` |
| Latência | `/api/v1/relatorios/latencia/export` | `GET` |
| Notificações | `/api/v1/relatorios/notificacoes/export` | `GET` |

`GET` é a decisão final porque a operação é idempotente, sem side effect funcional, e reutiliza um conjunto pequeno de query params já homologados. As URLs permanecem curtas mesmo com todos os filtros. O backend deve enviar `Cache-Control: no-store`; proxies não devem armazenar conteúdo operacional autenticado.

Não haverá `/export?format=csv`, extensão `.csv` na rota nem `POST` no V1: só existe um formato. Um formato futuro deve ganhar contrato próprio ou negociação explícita, sem reinterpretar silenciosamente esta rota.

### 3.2 Filtros, período e sort

`inicio` e `fim` são obrigatórios, em ISO-8601 com offset, normalizados para `Instant`. Os demais filtros são opcionais. `page` e `size` **não pertencem** às rotas de exportação; se enviados, retornam `400 INVALID_REQUEST` para não sugerir falsamente que o arquivo representa uma página. O mesmo vale para `format` no V1.

| Relatório | Filtros exportáveis | Limite temporal | Sort permitido | Sort padrão |
|---|---|---:|---|---|
| Disponibilidade Equipamentos | `inicio`, `fim`, `unidadeId`, `equipamentoId`, `monitorId`, `tipoEquipamentoId` | 365 dias | `equipamentoNome`, `unidadeNome`, `monitorNome`, `disponibilidadePercentual`, `tempoIndisponivelSegundos`, `tempoMonitoradoSegundos`, `incidentes` | `equipamentoNome,asc` |
| Disponibilidade Unidades | `inicio`, `fim`, `unidadeId` | 365 dias | `unidadeNome`, `equipamentosTotal`, `equipamentosMonitorados`, `equipamentosSemMonitoramento`, `tempoIndisponivelSegundos`, `disponibilidadePercentual`, `incidentes` | `unidadeNome,asc` |
| Incidentes | `inicio`, `fim`, `unidadeId`, `equipamentoId`, `monitorId`, `status` | 365 dias | `iniciadoEm`, `encerradoEm`, `duracaoSegundosNoPeriodo`, `status`, `unidadeNome`, `equipamentoNome`, `monitorNome` | `iniciadoEm,desc` |
| Medições | `inicio`, `fim`, `unidadeId`, `equipamentoId`, `monitorId`, `status` | 31 dias | `executadoEm`, `status`, `latenciaMs`, `unidadeNome`, `equipamentoNome`, `monitorNome` | `executadoEm,desc` |
| Latência | `inicio`, `fim`, `unidadeId`, `equipamentoId`, `monitorId` | 90 dias | `unidadeNome`, `equipamentoNome`, `monitorNome`, `minLatenciaMs`, `avgLatenciaMs`, `maxLatenciaMs`, `count` | `monitorNome,asc` |
| Notificações | `inicio`, `fim`, `incidenteId`, `status`, `canal`, `tipoEvento` | 365 dias | `createdAt`, `enviadoEm`, `status`, `canal`, `tipoEvento`, `tentativas` | `createdAt,desc` |

O arquivo respeita o sort corrente do usuário quando enviado. Ausente, aplica o mesmo padrão da tela/API. Campo ou direção fora da whitelist retorna `400 INVALID_REQUEST`; nunca se concatena sort arbitrário a SQL. Nulos continuam com `NULLS LAST`. A query adiciona silenciosamente uma chave pública estável como desempate (`equipamentoId`/`monitorId`, `unidadeId`, `incidenteId`, `medicaoId` ou `notificacaoId`), sem criar novo valor aceito em `sort`.

As validações de existência e coerência hierárquica são exatamente as atuais. Também se preserva a semântica temporal real: disponibilidade em `[inicio,fim)`; incidentes por interseção com o período; medições e amostras de latência pelos limites atuais; notificações por `created_at`. A R04.2 deve extrair/reutilizar essas validações e queries, não copiá-las de modo divergente.

### 3.3 Conjunto exportado

O arquivo contém **todo o conjunto filtrado e ordenado**, até o limite operacional. A página atualmente visível não influencia o resultado. O backend não repetirá chamadas paginadas nem usará `OFFSET` em loop; o Angular fará uma única chamada à rota de exportação.

## 4. Formato CSV

Contrato byte a byte:

- encoding: UTF-8;
- BOM: **sim**, exatamente `EF BB BF` no início, para preservar acentuação na abertura direta em Excel no ambiente Windows/pt-BR;
- separador: vírgula (`,`), independente do locale;
- cabeçalho: obrigatório, uma vez, mesmo para resultado vazio;
- final de linha: CRLF (`\r\n`) em todas as linhas, conforme RFC 4180;
- escaping: RFC 4180; envolver em aspas duplas campo que contenha vírgula, aspas, CR ou LF e duplicar cada aspas interna;
- números: sem aspas salvo necessidade técnica, sem agrupador de milhar e com ponto decimal;
- conteúdo textual: preservar Unicode após neutralização de fórmula;
- linha vazia adicional ao final: não gerar; a última linha termina em CRLF.

O BOM é uma decisão de compatibilidade, não parte do conteúdo do primeiro header. Embora a R01 previsse ausência de BOM, os headers e valores têm português acentuado e o cliente alvo é navegador/Excel em Windows; o custo de três bytes é desprezível. A R04.5 deve confirmar a abertura em Excel e a importação por parser RFC 4180.

### 4.1 CSV/Formula Injection

Aspas CSV não impedem execução de fórmulas. Antes do escaping RFC 4180, todo valor **textual e potencialmente controlado por usuário** deve ser neutralizado com um apóstrofo ASCII (`'`) quando o primeiro caractere não branco for `=`, `+`, `-` ou `@`, ou quando o valor começar por tab, CR ou LF. Isso vale para nomes de Unidade, Equipamento e Monitor, `motivo` e `observacao` e qualquer texto livre que venha a ser aprovado no contrato.

Exemplo: `=HYPERLINK(...)` vira `'=HYPERLINK(...)`; em seguida recebe o escaping CSV normal se necessário. A neutralização ocorre no serializador de exportação e não altera o dado persistido. Headers fixos não passam por essa regra. IDs, contagens, durações, latências e decimais permanecem tipos numéricos reais; datas e enums são produzidos pelo backend, não por texto arbitrário. Nunca converter número negativo real em texto prefixado.

Os testes devem cobrir também espaços antes do marcador, tab, CR/LF, vírgula e aspas combinados. Nenhum valor perigoso pode chegar como fórmula executável à célula.

## 5. Colunas e representação de dados

Os nomes abaixo são headers normativos, estáveis, em `snake_case`, e a ordem listada é parte do contrato. A R04.2 criará DTO/projeção explícita por exportação. Entidades JPA nunca serão serializadas.

### 5.1 Disponibilidade Equipamentos

`unidade_id`, `unidade_nome`, `equipamento_id`, `equipamento_nome`, `monitor_id`, `monitor_nome`, `tipo_monitor`, `inicio`, `fim`, `estado_analitico`, `qualidade_janela`, `tempo_monitorado_segundos`, `tempo_indisponivel_segundos`, `tempo_disponivel_segundos`, `disponibilidade_percentual`, `incidentes`.

Uma linha continua representando um Monitor ICMP; equipamento sem monitoramento preserva os nulos do contrato analítico.

### 5.2 Disponibilidade Unidades

`unidade_id`, `unidade_nome`, `inicio`, `fim`, `estado_analitico`, `equipamentos_total`, `equipamentos_monitorados`, `equipamentos_sem_monitoramento`, `equipamentos_sem_dados`, `tempo_monitorado_segundos`, `tempo_indisponivel_segundos`, `tempo_disponivel_segundos`, `disponibilidade_percentual`, `incidentes`.

O percentual é a média ponderada por tempo já calculada no backend; não se calcula a partir de linhas no exportador.

### 5.3 Incidentes

`incidente_id`, `unidade_id`, `unidade_nome`, `equipamento_id`, `equipamento_nome`, `monitor_id`, `monitor_nome`, `tipo_monitor`, `status`, `iniciado_em`, `encerrado_em`, `duracao_segundos_no_periodo`, `motivo`, `observacao`.

`encerrado_em` fica vazio para incidente aberto. A duração continua sendo apenas a interseção com o período solicitado. `motivo` e `observacao` recebem proteção contra Formula Injection.

### 5.4 Medições

`medicao_id`, `unidade_id`, `unidade_nome`, `equipamento_id`, `equipamento_nome`, `monitor_id`, `monitor_nome`, `tipo_monitor`, `status`, `latencia_ms`, `executado_em`.

`latencia_ms` nula fica vazia e nunca vira zero. Não existe coluna `mensagem`, pois ela não pertence ao DTO real homologado.

### 5.5 Latência

`unidade_id`, `unidade_nome`, `equipamento_id`, `equipamento_nome`, `monitor_id`, `monitor_nome`, `inicio`, `fim`, `min_latencia_ms`, `avg_latencia_ms`, `max_latencia_ms`, `p95_latencia_ms`, `amostras`.

`amostras` mapeia o `count` público. P95 e média vêm do PostgreSQL; o exportador não os recalcula. Com zero amostras, as quatro métricas ficam vazias e `amostras` é `0`.

### 5.6 Notificações

`notificacao_id`, `incidente_id`, `tipo_evento`, `canal`, `status`, `tentativas`, `created_at`, `enviado_em`.

`enviado_em` nulo fica vazio. `erro` não é exportado, mesmo existindo no DTO da tela, para impedir vazamento de detalhe interno, exceção, stack trace, URL/token de integração ou conteúdo legado não sanitizado. Mensagem completa, próxima tentativa e demais campos internos também ficam fora.

### 5.7 Regras comuns de valores

- `null`: campo vazio entre delimitadores; nunca `null`, `undefined`, `NaN` ou travessão.
- Datas: `Instant` em ISO-8601 UTC com sufixo `Z`, por exemplo `2026-08-25T14:32:10Z`; nunca horário local ambíguo.
- Decimais: representação plain, ponto decimal, sem notação científica; disponibilidade e média mantêm escala contratual de duas casas quando calculadas.
- Inteiros: base 10, sem separador de milhares.
- Enums: valor estável do backend, sem tradução. Valores atuais incluem `CALCULADO`, `SEM_DADOS`, `SEM_MONITORAMENTO`, `PRECISA`, `INFERIDA`, `ABERTO`, `FECHADO`, `SUCESSO`, `FALHA`, `TELEGRAM`, `INCIDENTE_ABERTO` e `INCIDENTE_FECHADO`; o serializador não mantém uma lista paralela capaz de rejeitar novos valores válidos do domínio.

## 6. Download, headers e filename

Resposta de sucesso:

```http
Content-Type: text/csv; charset=UTF-8
Content-Disposition: attachment; filename="<nome-seguro>.csv"; filename*=UTF-8''<nome-seguro>.csv
Cache-Control: no-store
```

O header `Content-Disposition` deve ser exposto no CORS em R04.2 com `exposedHeaders("Content-Disposition")`, preservando origens permitidas, headers atuais e `allowCredentials(false)`. Isso é necessário para o Angular ler o nome; não é necessário expor `Authorization`.

Padrão determinístico, calculado pelo backend:

```text
<relatorio>_<inicio-UTC-yyyy-MM-dd>_<fim-UTC-yyyy-MM-dd>.csv
```

Slugs permitidos: `disponibilidade-equipamentos`, `disponibilidade-unidades`, `incidentes`, `medicoes`, `latencia`, `notificacoes`. Exemplos: `medicoes_2026-08-01_2026-08-25.csv` e `disponibilidade-equipamentos_2026-08-01_2026-08-25.csv`.

Só entram componentes produzidos pelo servidor e a data UTC derivada dos instantes validados. Remover qualquer caractere fora de `[a-z0-9._-]`, impedir CR/LF e traversal, e não refletir texto bruto de request. Nunca incluir nome/e-mail do usuário, IDs de filtro, JWT ou dado pessoal. `filename` ASCII é a fonte de fallback; `filename*` mantém contrato compatível.

Na R04.3, `RelatorioApiService` requisita `responseType: 'blob'` e `observe: 'response'`, lê e valida `Content-Disposition`, usa fallback com o mesmo padrão quando ausente/inválido, cria uma Object URL, aciona o download e sempre a revoga. `window.open` não serve porque o bearer em memória não acompanha uma navegação comum.

## 7. Limites, erro e timeout

### 7.1 Limite de linhas

O teto V1 é **100.000 linhas de dados**, depois dos filtros e antes de iniciar a resposta; o cabeçalho não conta. Este valor não é arbitrário novo: já era a decisão preliminar da R01. A R04.1 o mantém após confrontá-lo com a única evidência disponível:

- a massa R02.5 tinha 150.500 medições e demonstrou que um conjunto realista já pode superar 100.000;
- a janela máxima de medições é 31 dias, mas 750 monitores a um minuto poderiam teoricamente produzir dezenas de milhões de eventos, logo apenas o limite temporal não contém o volume;
- R02.5 mediu consulta paginada, não serialização/transferência de 100.000 linhas; portanto não há evidência para elevar o teto;
- com projeção/cursor e streaming, o teto limita tempo, tráfego e duração da transação sem exigir que 100.000 objetos residam na heap.

A R04.2 deve fazer `COUNT` com exatamente os mesmos filtros antes de enviar BOM/headers do corpo. Resultado acima de 100.000 retorna JSON, nunca CSV parcial:

```json
{
  "status": 422,
  "error": "Unprocessable Entity",
  "code": "EXPORT_LIMIT_EXCEEDED",
  "message": "A exportação excede o limite de 100000 linhas; restrinja o período ou os filtros.",
  "path": "/api/v1/relatorios/medicoes/export"
}
```

O formato completo continua sendo `ErroResposta`, com `timestamp` e sem stack trace. O status **422** distingue uma consulta sintaticamente/semanticamente válida que excedeu a capacidade operacional. Período, filtro e sort inválidos continuam `400 INVALID_REQUEST`; ID inexistente continua `404 RESOURCE_NOT_FOUND`.

O limite deve ser propriedade configurável de implantação com default e máximo público V1 de 100.000; configuração pode reduzi-lo em ambiente restrito, nunca elevá-lo sem novo benchmark e revisão deste contrato. Não se define limite fixo de bytes no V1: UTF-8 e textos escapados tornam bytes variáveis, e o teto de linhas, comprimentos de colunas e timeout já contêm o risco. R04.2 deve medir bytes para observabilidade.

### 7.2 Timeout

Orçamento V1: **60 segundos** para contagem, consulta, serialização e entrega pelo backend, configurável para redução por ambiente. O proxy/load balancer deve ter timeout superior ao da aplicação (recomendação operacional mínima: 75 segundos), ou a aplicação não conseguirá controlar o encerramento.

Se o timeout ocorrer antes do commit, retornar `503` JSON com `code=EXPORT_TIMEOUT`. Se ocorrer depois do início do streaming, encerrar a conexão, jamais inserir mensagem de erro dentro do CSV, e registrar falha; o frontend trata download interrompido como erro. R04.5 deve verificar o comportamento no proxy real. A ausência atual de configuração de timeout de request é risco de deploy e item obrigatório da R04.2/R04.5.

## 8. Estratégia de implementação para R04.2

Fluxo normativo:

1. autenticar e aplicar RBAC/filtros de segurança existentes;
2. validar período, IDs, hierarquia e whitelist de sort pelas mesmas rotinas dos endpoints de tela;
3. abrir transação PostgreSQL somente leitura, com snapshot consistente, e executar count dedicado com os mesmos predicados;
4. recusar acima do limite antes de escrever o corpo;
5. configurar headers de download;
6. no mesmo snapshot do count, executar uma query/projeção dedicada, ordenada, com cursor/fetch size;
7. mapear cada linha para DTO de exportação explícito, neutralizar texto e serializar diretamente no `Writer` UTF-8;
8. concluir/registrar quantidade, bytes, duração e resultado.

É proibido chamar o endpoint paginado repetidamente, avançar `OFFSET`, carregar entidades completas, usar `findAll()` amplo ou acumular `List` de 100.000 linhas. O uso de buffer pequeno do writer é permitido; a memória deve ser aproximadamente constante em relação ao total de linhas. A fronteira transacional deve permanecer ativa até o cursor fechar; count e stream não podem usar snapshots diferentes, pois inserções concorrentes poderiam ultrapassar o limite ou tornar contagem e arquivo incoerentes. A R04.2 deve provar essa fronteira com teste PostgreSQL, sem depender de transação já encerrada ao executar callback assíncrono.

Disponibilidade é o maior risco de **CPU/query**, por suas CTEs, união temporal e count repetido. Medições são o maior risco de **cardinalidade, bytes e duração**, pois o dado cresce continuamente e 150.500 linhas já existiam na massa R02.5. A implementação deve reutilizar/extrair a CTE e projeções atuais, com query final sem `LIMIT/OFFSET`, cursor e desempate estável. Incidentes, medições, latência e notificações devem preservar seus joins/agregados SQL e nunca introduzir N+1.

R04.2 deve benchmarkar separadamente 0, 1, 99.999, 100.000 e 100.001 linhas (massa equivalente quando custo de fixture exigir), registrar tempo de count, time-to-first-byte, tempo total, bytes, heap/GC, buffers/plano PostgreSQL e comportamento de cancelamento. `EXPLAIN (ANALYZE, BUFFERS)` deve ser repetido nas queries de maior risco. Se 100.000 não couber em 60 segundos no ambiente de homologação, reduzir o limite documentadamente ou migrar o desenho antes de homologar; não esconder o problema aumentando timeout.

Critérios para uma V2 assíncrona: exportações válidas frequentemente excederem 100.000 linhas/60 segundos, necessidade de retomada, múltiplas exportações concorrentes impactarem o banco, ou requisito de retenção/entrega posterior. Só então avaliar job persistido, fila, storage temporário criptografado, expiração, autorização por proprietário e download autenticado. Nada disso entra no MVP.

## 9. Segurança e RBAC

As rotas são leitura de Relatórios e seguem o mesmo RBAC:

| Condição | Resultado |
|---|---|
| `ADMIN` ativo, senha regular | permitido |
| `OPERADOR` ativo, senha regular | permitido |
| `VISUALIZADOR` ativo, senha regular | permitido |
| sem JWT, bearer inválido/expirado ou conta inativa | `401 UNAUTHORIZED` em JSON |
| `PASSWORD_CHANGE_REQUIRED` | `403 PASSWORD_CHANGE_REQUIRED` em JSON |
| papel sem leitura, se futuramente existir | `403 FORBIDDEN` em JSON |

Não se cria permissão `EXPORT` no V1, pois o usuário já pode ler o mesmo conjunto e a exportação não amplia o recorte. O bearer só vai no request HTTPS e jamais no filename, corpo, log ou URL além dos filtros não secretos. Produção deve usar TLS.

Somente contratos/projeções explícitos podem alimentar CSV. É terminantemente proibido exportar entidade JPA ou reflexão genérica. Nenhum arquivo, erro ou log pode conter JWT, `Authorization`, senha, `senhaHash`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_PASSWORD`, token/chat secret do Telegram, stack trace, exception interna, configuração, campos de entidade/auditoria não listados ou conteúdo de notificação. O campo `erro` de notificação está fora do CSV por defesa em profundidade.

Erros HTTP são sempre JSON `ErroResposta`, com o Content-Type JSON apropriado. Nunca retornar status 200 com mensagem de erro em CSV.

## 10. Logging e auditoria

O V1 terá log estruturado de exportação, sem criar tabela de auditoria nesta fase. Registrar eventos `REPORT_EXPORT_STARTED` e `REPORT_EXPORT_COMPLETED` ou `REPORT_EXPORT_FAILED` com:

- `userId` interno e papel;
- tipo do relatório;
- `inicio`/`fim` UTC;
- filtros normalizados por IDs/enums e sort validado;
- quantidade prevista e efetivamente escrita;
- bytes, duração, timestamp, resultado/código de erro e correlation/request ID.

Não registrar corpo CSV, nomes/textos livres, e-mail/nome pessoal, `Authorization`, JWT, senha/hash, secrets, token Telegram, stack trace ou mensagem interna de banco/integração. A exceção completa pode seguir a política segura do logger interno apenas se sanitizada e nunca como campo de auditoria; logs de produção precisam de controle de acesso e retenção definidos pela operação.

## 11. UX e contrato da R04.3

Cada dataset tabular terá botão **Exportar CSV**. O clique envia período, filtros e sort correntes, mas não envia página/tamanho. Durante a requisição, o botão mostra loading e fica desabilitado para impedir cliques concorrentes daquele relatório. O estado da tela, filtros, sort e página visual são preservados.

Sucesso baixa o Blob com filename validado. Resultado vazio ainda baixa CSV com BOM e header. Erro 400/401/403/404/422/500/503 continua no fluxo JSON de erros e exibe mensagem acionável; `EXPORT_LIMIT_EXCEEDED` orienta reduzir período/filtros. Falha não deve disparar download de JSON com extensão `.csv`.

## 12. Matriz obrigatória de testes

### 12.1 R04.2 — backend CSV

| Área | Casos mínimos obrigatórios |
|---|---|
| Contrato HTTP | seis rotas GET; query params exatos; rejeição 400 de `page`, `size` e `format`; `Content-Type`; `Content-Disposition`; `Cache-Control`; filename e fallback ASCII; vazio com header |
| Colunas | header e ordem exata de cada um dos seis contratos; nenhum campo extra; notificação sem `erro`; medição sem campo inexistente |
| CSV | BOM único; UTF-8/acentos `ç`, `ã`, `é`; vírgula; CRLF; aspas; aspas duplicadas; vírgula, CR, LF e combinações; parse round-trip RFC 4180 |
| Injection | `=`, `+`, `-`, `@`, prefixos com espaços, tab, CR/LF e fórmula com vírgula/aspas; números negativos reais inalterados |
| Tipos | null vazio; data UTC `Z`; decimal com ponto/sem locale/notação científica; escala; enum estável; latência nula não zero; incidente aberto sem encerramento |
| Semântica | mesmos filtros dos seis relatórios; coerência hierárquica; inexistente 404; período/fronteiras; fórmula de disponibilidade; P95 backend; todo conjunto, não página atual |
| Sort | cada campo de whitelist e direções; defaults; `NULLS LAST`; desempate estável; sort inválido 400; tentativa de SQL injection rejeitada |
| Limites | períodos 365/365/31/90/365; 99.999, 100.000 e 100.001 linhas; header fora da contagem; 422 e `EXPORT_LIMIT_EXCEEDED`; nenhuma resposta parcial no preflight |
| Segurança | ADMIN/OPERADOR/VISUALIZADOR; 401 sem/inválido/expirado/inativo; 403 `PASSWORD_CHANGE_REQUIRED`; 403 de papel; nenhum segredo/campo proibido; erros JSON sem stack trace |
| CORS | preflight/origem permitida; `Authorization`; `Access-Control-Expose-Headers: Content-Disposition`; `credentials=false`; origem não permitida |
| Streaming | cursor/fetch size; count e cursor no mesmo snapshot/transação; memória aproximadamente constante; sem lista ampla, N+1, loop paginado ou OFFSET profundo; cancelamento do cliente; falha antes/depois do commit; timeout |
| Performance | benchmark dos cinco volumes, concorrência acordada, count/query/TTFB/total/bytes/heap/GC; EXPLAIN das queries críticas; regressão dos endpoints R02 |
| Auditoria | start/success/failure; campos aprovados; quantidade/bytes/duração; ausência de bearer, secrets, conteúdo e stack trace |

Os testes de segurança devem procurar literalmente, em header/corpo/log capturado, `Bearer`, `Authorization`, `senha`, `senhaHash`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_PASSWORD`, padrões de bot token/URL Telegram e stack frames, sem gravar segredos reais em fixture.

### 12.2 R04.3 — frontend CSV

| Área | Casos mínimos obrigatórios |
|---|---|
| Service | uma chamada GET por clique; endpoint correto por relatório; período/filtros/sort atuais; ausência de `page`/`size`; bearer via interceptor; `observe=response`; `responseType=blob` |
| Download | lê `Content-Disposition` (`filename` e `filename*`); sanitiza; fallback determinístico; cria/clica/revoga Object URL; Blob `text/csv`; vazio ainda baixa arquivo |
| UX | botão nos seis datasets e ausente na Visão Geral; loading; bloqueio de duplo clique; sucesso; erro; retry; preservação de aba/filtros/sort/página; acessibilidade por teclado/leitor |
| Erros/RBAC | 400, 401, 403, 404, 422 `EXPORT_LIMIT_EXCEEDED`, 500, 503 e erro de rede; JSON nunca salvo como CSV; redirects atuais de sessão e troca de senha preservados |
| Navegador | Chrome/Playwright real; arquivo salvo; filename; acentos; download repetido após conclusão; responsividade desktop/tablet/mobile |

### 12.3 R04.5 — homologação integrada

| Área | Casos mínimos obrigatórios |
|---|---|
| Stack real | Angular + Spring Boot + PostgreSQL + Chrome/Playwright nas URLs homologadas; JWT real dos três papéis |
| Conteúdo | comparar tela/consulta e CSV para os mesmos filtros/sort; validar primeiro/último/contagem e amostra de linhas; salvar e parsear os seis arquivos |
| Planilhas | abrir arquivo real no Excel alvo e em parser RFC 4180; confirmar BOM, acentos, vírgula, CRLF, datas, decimais, null e headers |
| Segurança | executar payloads de Formula Injection e confirmar célula textual; 401/403/inativo/troca de senha; CORS; busca por todos os campos proibidos em arquivo/log |
| Limites/falhas | 100.000/100.001; timeout/proxy; cancelamento; falha PostgreSQL simulada; arquivo parcial não apresentado como sucesso |
| Performance | carga representativa e concorrente; metas de 60 s/100.000; CPU/heap/GC/banco/bytes; EXPLAIN; ausência de N+1/OFFSET loop; regressão R02/R03 |
| UX | loading, duplo clique, erro acionável, filename/fallback, estado preservado, responsividade e acessibilidade |

## 13. PDF futuro — R04.4

Nenhum PDF é implementado ou contratado nesta fase. A candidata inicial é geração server-side a partir de template de relatório versionado, avaliando HTML→PDF headless e biblioteca Java quanto a licença, fontes, Unicode, acessibilidade, paginação, consumo de memória, segurança de HTML/URLs, determinismo e manutenção. Serviço externo só entra se requisitos operacionais/compliance justificarem envio de dados para terceiro.

O PDF não deve ser screenshot acidental da tela. Deve reutilizar DTOs/agregações do backend, ter contrato de colunas/seções e excluir os mesmos campos proibidos. A Visão Geral é candidata natural ao PDF consolidado; datasets tabulares podem ter PDF resumido, não necessariamente todas as 100.000 linhas. A escolha de biblioteca, endpoint, síncrono/assíncrono, limite e layout fica expressamente adiada para a análise técnica R04.4.

## 14. Roadmap R04

| Fase | Entrega |
|---|---|
| R04.1 | arquitetura, contratos, segurança, limites e matrizes de teste — este documento |
| R04.2 | backend CSV, DTOs/projeções explícitas, streaming, headers/CORS, limites, auditoria e testes/benchmark |
| R04.3 | frontend CSV como Blob, UX, filename e testes/browser |
| R04.4 | decisão técnica e implementação PDF em escopo próprio, sem ser iniciada pela R04.1 |
| R04.5 | homologação integrada, segurança, Excel, carga e regressão |
| R04.6 | fechamento documental e pendências reais |

## 15. Checklist de aceite R04.1

- [x] escopo dos seis CSVs e exclusão fundamentada da Visão Geral;
- [x] backend como único gerador e conjunto filtrado completo;
- [x] síncrono agora e gatilhos objetivos para assíncrono futuro;
- [x] streaming, cursor e memória constante; sem paginação em loop;
- [x] endpoints GET, filtros, sort/whitelist/defaults e desempate;
- [x] limites temporais homologados, 100.000 linhas analisadas, timeout e erro 422;
- [x] UTF-8, BOM, vírgula, CRLF, RFC 4180, header e Formula Injection;
- [x] Content-Type, Content-Disposition, filename e CORS expose header;
- [x] colunas explícitas dos seis relatórios, null, UTC, decimais e enums;
- [x] DTO/projeção explícita, RBAC e todos os campos proibidos;
- [x] performance, N+1, count, logging/auditoria e riscos de deploy;
- [x] estratégia candidata e decisões adiadas de PDF;
- [x] matrizes R04.2, R04.3 e R04.5 e roadmap;
- [x] somente `Docs/reports-export-architecture.md` criado pela fase.

Com essas decisões, a arquitetura está completa para iniciar R04.2, que não faz parte desta execução.
