# PDF consolidado da Visão Geral - arquitetura R04.4

## Decisão

O PDF V1 é gerado programaticamente no Spring Boot com Apache PDFBox 3.0.8. O fluxo é:

```text
GET autenticado
  -> validação do período
  -> coleta global em snapshot PostgreSQL
  -> VisaoGeralPdfModel
  -> VisaoGeralPdfRenderer
  -> byte[] PDF
  -> resposta HTTP
```

Não há acesso ao Angular, DOM, screenshot, Chrome, página visual, paginação em loop, fila, job ou storage. A alternativa template server-side para PDF foi descartada no V1: o documento tem somente três KPIs e três tabelas pequenas, portanto HTML/CSS acrescentaria um conversor e uma superfície de segurança sem reduzir a complexidade. O renderer programático mantém paginação, tabelas, cabeçalho, rodapé e truncamento seguro em uma classe versionada.

A resposta é síncrona. O benchmark warm com 25 unidades, 25 monitores, 59 medições, 25 incidentes e 25 notificações ficou na ordem de dezenas de milissegundos; não há evidência para fila ou armazenamento. O relatório é executivo e limita cada tabela a cinco linhas.

## Auditoria da biblioteca

| Critério | Resultado |
|---|---|
| Biblioteca | Apache PDFBox |
| Versão | 3.0.8, publicada em 11/07/2026 |
| Licença | Apache License 2.0 |
| Java/Spring Boot | PDFBox 3 requer Java 8 ou superior; o projeto usa Java 21 e Spring Boot 4.1.0 |
| Unicode | `PDType0Font` com Liberation Sans incorporada ao PDF para dados; testes cobrem São José, Produção e Monitoração |
| Tabelas | Implementadas no renderer com largura fixa, bordas, cabeçalho repetido e truncamento visual seguro |
| Paginação | Quebra automática antes do rodapé e repetição do header da tabela; teste multipágina |
| Manutenção | Projeto ativo da Apache Software Foundation; 3.0.8 é a release corrente na data da decisão |
| Segurança | 3.0.8 corrige os CVEs publicados que alcançavam 3.0.7. O caso de uso apenas cria PDF a partir de DTO interno e não processa PDF não confiável nem usa o módulo de exemplos afetado por path traversal |

Fontes da auditoria: [site e release 3.0.8](https://pdfbox.apache.org/), [dependência Maven oficial](https://pdfbox.apache.org/3.0/getting-started.html), [licença e criação com fontes incorporadas](https://pdfbox.apache.org/), [guia de migração/Java](https://pdfbox.apache.org/3.0/migration.html) e [histórico de segurança](https://pdfbox.apache.org/security.html).

## Contrato HTTP

```http
GET /api/v1/relatorios/visao-geral/export/pdf?inicio=<Instant>&fim=<Instant>
```

Sucesso: `200`, `Content-Type: application/pdf`, `Cache-Control: no-store`, `Content-Length` e `Content-Disposition: attachment` com `filename` e `filename*`. O nome determinístico é `visao-geral_<data-inicio>_<data-fim>.pdf`, sempre UTC e somente ASCII seguro.

Falhas continuam no contrato JSON `ErroResposta`; validação nunca retorna bytes PDF. `inicio` e `fim` são obrigatórios, `inicio > fim` é inválido, `inicio = fim` é aceito segundo a semântica analítica homologada e o intervalo máximo é exatamente 31 dias, sem truncamento.

## Modelo e conteúdo

`VisaoGeralPdfModel` é imutável e contém somente tipos escalares e listas explícitas:

- período, geração e os três counts globais;
- Top 5 de Unidades, com disponibilidade, estado e incidentes;
- Top 5 de Equipamentos/Monitores críticos, com disponibilidade, estado, qualidade e incidentes;
- Top 5 de Latência por média descendente, com min/avg/max/P95/count.

Entidades JPA não chegam ao renderer. Valor ausente vira `-`, nunca `0%`, `null`, `undefined` ou `NaN`. Disponibilidade calculada mantém duas casas. A legenda explica `CALCULADO`, `SEM_DADOS`, `SEM_MONITORAMENTO`, `PRECISA`, `INFERIDA` e `NULLS LAST`; a informação não depende somente de cor.

## Regras analíticas e consultas

Os KPIs são `count(*)` globais com os mesmos filtros homologados da Visão Geral:

- Incidentes `ABERTO` que intersectam o período;
- Medições `FALHA` executadas no período;
- Notificações `FALHA` criadas no período.

Disponibilidade reutiliza integralmente a CTE PostgreSQL homologada em R02/R04.2. A Unidade soma tempos dos monitores calculáveis e calcula a razão apenas depois da soma; não há média simples. Equipamentos e Unidades ordenam `disponibilidade ASC NULLS LAST` antes do `LIMIT 5`. Latência usa `min`, `round(avg, 2)`, `max`, `percentile_cont(0.95)` e `count` no PostgreSQL; P95 chega pronto ao modelo e não é recalculado pelo Java/template.

As quatro consultas rodam em uma transação `readOnly`, isolamento `REPEATABLE_READ`, logo todos os KPIs e rankings observam o mesmo snapshot. `statement_timeout` local é configurável por `REPORT_PDF_TIMEOUT_SECONDS`, padrão 60 s e limite interno de 120 s. Não há N+1 de entidades nem loop de páginas.

## RBAC, segurança e auditoria

O endpoint herda a política de GET analítico: `ADMIN`, `OPERADOR` e `VISUALIZADOR` são permitidos; sem JWT ou conta inativa retorna `401`; `PASSWORD_CHANGE_REQUIRED` retorna `403`.

O modelo, PDF, filename e logs não incluem JWT, Authorization, senha, senhaHash, JWT_SECRET, token Telegram, mensagem de notificação, erro interno, connection string, stack trace ou conteúdo do PDF. O metadata do PDF contém apenas título, autor do sistema e assunto.

O logger estruturado `REPORT_EXPORT_AUDIT` emite `PDF_EXPORT_STARTED`, `PDF_EXPORT_SUCCEEDED` e `PDF_EXPORT_FAILED` com `correlationId`, `userId`, `papel`, relatório, período, timestamp, resultado e duração. Sucesso acrescenta bytes, tempo de consultas e tempo de geração. Falha registra somente a classe/código seguro; o conteúdo do PDF nunca é logado.

## Performance e EXPLAIN

Massa determinística de homologação: 25 unidades, 25 equipamentos, 25 monitores, 25 janelas precisas, 59 medições, 25 incidentes abertos e 25 notificações com falha. Cada PDF tem 15 linhas de tabelas e uma página. Foram executados um aquecimento e três runs warm; a memória é uma aproximação por heap ocupado antes/depois e pode sofrer interferência do GC.

Resultados warm da suíte completa com a fonte incorporada: consultas 10/10/11 ms, geração 26/27/36 ms, total 39/41/52 ms, 16.140 bytes, memória aproximada 20.971.520/0/19.906.824 bytes. O resultado confirma resposta síncrona com ampla margem frente ao timeout de 60 s.

`EXPLAIN (ANALYZE, BUFFERS)` no PostgreSQL 16.15 com essa massa:

| Consulta | Planning | Execution | Observação |
|---|---:|---:|---|
| KPIs | 0,235 ms | 0,125 ms | índices de incidente aberto, período de medição e status/data de notificação |
| Top Unidades | 2,561 ms | 1,993 ms | CTE temporal homologada; top-N heapsort 25 kB |
| Top Equipamentos | 1,075 ms | 0,892 ms | CTE temporal homologada; top-N heapsort 26 kB |
| Latência | 0,441 ms | 0,792 ms | agregação PostgreSQL/P95; top-N heapsort 26 kB |

Os `Seq Scan` observados percorrem tabelas de apenas 25 linhas e têm custo menor que usar índice; os joins relevantes usam os índices existentes. Não houve sort em disco, buffer read significativo ou evidência para índice novo. Nenhum índice foi criado.

## Testes e operação

Os testes usam `postgres:16-alpine` via Testcontainers. O bloqueador de globalidade cria 25 registros, deixa o pior item fora das primeiras 20 linhas alfabéticas e comprova pelo texto extraído do próprio PDF que os KPIs valem 25 e o ranking contém o item global. A validação principal usa assinatura `%PDF`, parsing pelo PDFBox, número de páginas e extração textual; OCR não é usado.

O smoke operacional deve salvar o artefato fora do repositório, validar headers, abrir/parsear o PDF, confirmar conteúdo essencial e procurar termos sensíveis. O frontend permanece independente e não foi alterado nesta fase.
