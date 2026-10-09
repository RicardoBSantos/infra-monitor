# Rodada final antes da carga real — mapa, A1/A2/A2b, publicação, procedimento de carga

Data: 2026-09-24. Árvore de trabalho: worktree `../infra-monitor-merge` (branch `main`). Commits
diretamente na `main`, **sem merge novo**. `feat/manutencao-equipamento` fica parado onde está.

Regras permanentes: banco de dev (5434) intocado — só `SELECT` de conferência e a subida do backend em
modo leitura; motor nunca contra ele (`monitoring.engine.enabled=false`); Telegram real nunca acionado
(`.env` nunca exportado; testes usam mock HTTP). Stage sempre por caminho explícito.
`Docs/validacao-producao/` atualizado no mesmo commit de cada mudança.

## 1. Mapa: clique no marcador limpa a seleção

### Hipótese (a confirmar com evidência antes de corrigir)

O `<button class="map__unidade">` vive dentro do container do MapLibre. O mesmo clique físico produz:
(a) o `click` DOM do botão → `selecionarPeloMarcador(unidade)` → `selectMunicipio(município do
`codigo_ibge`)` + `selectUnidade(unidade)`; (b) o `click` do mapa em `municipios-fill`
(`mapa.component.ts:667`), que consulta o polígono **sob o pixel**, isto é, o município das
coordenadas → `selectMunicipio(polígono)` → com ≠1 unidade, `limparUnidade()`.

Com IBGE = município da coordenada e uma unidade só, (b) re-seleciona a mesma unidade e o defeito
fica escondido. Com IBGE divergente (ITA-09: IBGE 2803005 Itabaianinha, coordenada em Itabaiana
2802908), (b) seleciona Itabaiana, que não contém a ITA-09 → painel vazio. **A verificar também:**
município com várias unidades e IBGE coerente (Aracaju) — pela leitura, (b) também limparia.

Evidência exigida: ordem real dos dois handlers (instrumentação temporária em teste/e2e, não no
código de produção), e reprodução por clique Playwright na ITA-09 antes da correção.

### Decisão: coordenada prevalece

A coordenada é o que posiciona o marcador; o que o usuário vê e clica é o marcador. Na carga real o
IBGE pode vir errado ou ausente. Portanto:

- **Clique no marcador sempre abre o painel da unidade**, independentemente do polígono sob ele.
- O IBGE continua sendo a chave de agrupamento do painel por município (não se move a unidade de
  município no painel por inferência — isso seria corrigir dado silenciosamente).
- A divergência passa a ser **visível**: aviso no painel da unidade no mapa e na tela de detalhe da
  unidade. Justificativa: silêncio deixaria IBGE errado da carga real invisível para sempre; o aviso
  é o único caminho para alguém corrigir o cadastro. Não bloqueia nada.

### Correção

- Função pura `cliqueVeioDeMarcador(alvo: EventTarget | null): boolean` —
  `alvo instanceof Element && !!alvo.closest('.map__unidade, .map__alvo')`. O handler
  `municipios-fill` retorna cedo quando `cliqueVeioDeMarcador(evento.originalEvent.target)`.
  Preferido a `stopPropagation` no botão porque não depende de qual evento DOM o MapLibre usa
  internamente para sintetizar o `click` (mousedown/mouseup/click, pointer), nem da ordem dos
  handlers — a investigação confirma qual dos dois é robusto; se a evidência mostrar que o
  `originalEvent.target` não é o botão, a correção muda para o mecanismo que a evidência sustentar.
- Função pura `municipioDaCoordenada(ponto, municipios): string | null` (point-in-polygon, ray
  casting, Polygon e MultiPolygon com buracos) e `divergenciaIbge(unidade, municipios)` →
  `{ codigoCoordenada, nomeCoordenada, codigoCadastro, nomeCadastro } | null`. Sem coordenada ou sem
  IBGE → `null` (ausência não é divergência; já existe a lista "sem localização").
- Aviso: painel da unidade no `/mapa` e aba Visão geral do detalhe da unidade, texto
  "A coordenada cai em {nomeCoordenada}, mas o código IBGE aponta {nomeCadastro} ({codigo}). O mapa
  posiciona pela coordenada." Estilo de aviso existente do projeto (`frontend-design` só se não houver
  primitiva de aviso). O detalhe carrega o GeoJSON via `GeoMunicipioService.getMunicipios()` (já
  cacheado com `shareReplay`); falha de carga → sem aviso, nunca derruba a tela.

### Testes

- Unitário (Vitest): `cliqueVeioDeMarcador` (botão, filho do botão, canvas, null),
  `municipioDaCoordenada` (dentro, fora, buraco, MultiPolygon, borda), `divergenciaIbge`, e o
  componente: disparar o handler de município com alvo marcador não limpa a unidade.
- E2E Playwright por clique (`e2e/mapa-marcador-ibge-divergente.cjs`), contra `ng serve` + backend
  local ligado ao banco de dev com motor e dispatcher desligados, login
  `admin@inframonitor.local` com senha por env `MAPA_SENHA`: clicar marcador ITA-09 → painel com
  ITA-09 e aviso; clicar marcador de unidade em Aracaju (várias unidades) → painel da unidade;
  clicar polígono vazio → seleção de município continua funcionando; detalhe da ITA-09 → aviso.
- Prova de reversão: com o `return` cedo removido, o unitário do componente e o e2e ITA-09 falham;
  restaurado, passam. Saídas registradas.

## 2. Riscos altos A1, A2, A2b

### A1 — fechamento manual

`IncidenteRepository.fecharManualmenteSeEmAberto(id, encerradoEm, observacao, usuario, agora)`:
bulk update JPQL `SET status=FECHADO, encerradoEm, observacao, motivoEncerramento=FECHAMENTO_MANUAL,
fechadoPor=:usuario, updatedAt WHERE id=:id AND status IN (ABERTO, RECONHECIDO)`,
`clearAutomatically/flushAutomatically`. `IncidenteService.fechar`: valida como hoje; retorno 0 →
releitura e resposta (idempotente, mesmo contrato de hoje para já-FECHADO), **sem notificação**;
retorno 1 → releitura e `criarParaIncidenteFechado`. `reconhecido_*` preservado (não está no SET).

### A2 — normalização do episódio (motor)

`MonitorEpisodioLatenciaRepository.encerrarPorNormalizacaoSeAberto(id, encerradoEm, agora)`:
`SET encerradoEm, motivoEncerramento=NORMALIZACAO, updatedAt WHERE id=:id AND encerradoEm IS NULL`.
`processarNormalizacao`: 0 → log debug, sem notificação; 1 → releitura, `criarParaLatenciaNormalizada`.

### A2b — releitura da manutenção

`EquipamentoService.entrarEmManutencao`: releitura de episódios filtra
`motivoEncerramento == MANUTENCAO`, espelho do filtro de incidentes.

### Testes (Testcontainers, arnês existente de `ManutencaoPostgresIntegrationTest` /
`NotificacaoConcorrenciaPostgresIntegrationTest`)

Todos: duas threads, `CyclicBarrier`, 30 repetições, contagem da distribuição de desfechos
impressa e registrada no doc, asserção de zero desfecho ilegítimo por repetição.

- A1 × fechar manual (dois operadores): exatamente um `INCIDENTE_FECHADO`, `fechado_por` coerente
  com o vencedor.
- A1 × `fecharAutomaticamente` (motor): linha e notificações coerentes — se motivo
  RECUPERACAO_AUTOMATICA então `fechado_por` NULL e observação do motor; se FECHAMENTO_MANUAL então
  `fechado_por` = operador; exatamente uma `INCIDENTE_FECHADO`.
- A1 × `entrarEmManutencao`: motivo MANUTENCAO ⇒ só `INCIDENTE_ENCERRADO_MANUTENCAO`;
  FECHAMENTO_MANUAL ⇒ só `INCIDENTE_FECHADO`; nunca as duas.
- A1 × `reconhecer`: se reconhecer respondeu sucesso, `reconhecido_*` não nulo no fim.
- A2/A2b × `entrarEmManutencao` × normalização: motivo MANUTENCAO ⇒ só
  `LATENCIA_ENCERRADA_MANUTENCAO`; NORMALIZACAO ⇒ nenhuma `LATENCIA_ENCERRADA_MANUTENCAO`; nunca as
  duas; `encerrado_em` nunca regravado.
- Prova de reversão: cada correção revertida isoladamente (A1 service, A2 processor, A2b filtro) →
  o teste correspondente acusa desfecho ilegítimo em ≥1 das 30; restaurado → verde. Se uma corrida
  não reproduzir em 30 sem a correção, registrar isso honestamente e usar pausa determinística
  (hook de teste já usado no arnês, se houver) em vez de afirmar prova.

A3, A4, A5 ficam documentados em `auditoria-concorrencia-ciclo-de-vida.md`, sem correção.

## 3. Publicar

1. `./mvnw test` completo (com Docker), `npx ng test --watch=false`, `npx ng build` (produção),
   e2e novo — contagens registradas.
2. Contagem das tabelas do banco de dev antes (início da rodada) e depois; devem bater.
3. `git push origin main`; `git fetch`; `git rev-parse main origin/main` iguais.
4. `git worktree remove ../infra-monitor-merge` (a árvore principal continua em
   `feat/manutencao-equipamento` com suas mudanças locais, intocadas). Falha só se o worktree tiver
   mudanças não commitadas — então parar e reportar.

## 4. Procedimento de carga real (não executado)

Local: `tools/carga-real/` na raiz do repositório.

- `carga.mjs` — Node ≥18, sem dependências (`fetch` nativo, parser CSV próprio simples com aspas).
  Entrada: um JSON `{tipos, unidades, equipamentos, monitores, conexoes}` ou um diretório com
  `tipos.csv unidades.csv equipamentos.csv monitores.csv conexoes.csv`.
- Ordem: tipo → unidade → equipamento → monitor → conexão de hub.
- Idempotência por chave natural lida da API antes de criar: tipo por nome (case-insensitive),
  unidade por sigla/código, equipamento por (unidade, nome case-insensitive), monitor por
  (equipamento, tipo, alvo), conexão por estado atual da unidade. Existente e igual → pula;
  existente e diferente → relata "divergente", **não** sobrescreve (PUT aplica corpo inteiro —
  ver dívida do PUT).
- `--dry-run` é o padrão; `--aplicar` envia. Relatório JSON + resumo no console:
  criados / pulados / divergentes / falhas, com motivo.
- Verificações antes de enviar (falha a linha, não o lote, exceto erros estruturais): obrigatórios
  presentes; coordenadas em par; IBGE 7 dígitos e existente no GeoJSON de SE; IBGE compatível com a
  coordenada (point-in-polygon com o mesmo GeoJSON do frontend) — divergência é **aviso**, não
  bloqueio, coerente com a decisão 1; IPv4 válido; IP repetido entre unidades (aviso) e dentro da
  unidade (erro); nome único por unidade no arquivo e contra a API; referências (tipo, unidade,
  equipamento) resolvíveis; ciclo de hub no grafo arquivo+API (erro).
- O que **não** valida: se o IP responde ping; se a coordenada é a real; se o IBGE está certo quando
  coerente com a coordenada; unicidade global de IP (o banco só exige por unidade); regras que só o
  backend conhece e que mudarem depois; concorrência com outro operador cadastrando ao mesmo tempo.
- Credencial: `CARGA_API_URL`, `CARGA_EMAIL`, `CARGA_SENHA` por variável de ambiente; papel mínimo
  **OPERADOR** (POST/PUT de tipos, unidades, equipamentos, monitores e `PUT /unidades/{id}/conexao`
  — conferir no `SecurityConfiguration`); usuário com troca de senha obrigatória falha no login e o
  script para.
- Modelo de entrada: `tools/carga-real/modelo/` com CSVs de cabeçalho + 1 linha de exemplo fictícia
  e `modelo.json`; `README.md` com colunas, obrigatoriedade, formato e exemplos de relatório.
- Teste: só testes unitários das funções puras (`node --test`), sem rede. Nada roda contra servidor.
