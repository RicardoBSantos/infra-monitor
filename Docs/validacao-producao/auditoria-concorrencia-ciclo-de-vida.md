# Auditoria de concorrência — escritas de ciclo de vida e transições de estado

Data: 2026-09-24. Branch: `feat/manutencao-equipamento`, HEAD `d486441`.

Situação posterior à leitura: os testes e a correção da Task 1 foram commitados em `b08fe75` e
`d1a0b14`; os da Task 2 em `84c04c8` e os da Task 3 em `1e44d9f`. Os números de linha abaixo continuam
sendo os do momento da leitura, salvo onde indicado.

Documento só de leitura: **nada foi corrigido por esta auditoria**. As três correções da rodada
(Tasks 1, 2 e 3 do desenho `Docs/superpowers/specs/2026-09-24-fechamento-dois-branches-design.md`,
seção 1) aparecem como linhas marcadas "corrigido nesta rodada", descritas pelo código **antes** da
correção e pelo que o desenho especifica como correção.

## Em destaque: teste sequencial não prova segurança concorrente

Duas chamadas em fila na mesma thread passam sobre código quebrado. O commit `9bac9f0` registrou
0 de 30 desfechos legítimos no primeiro teste com threads reais enquanto os testes sequenciais da
mesma corrida estavam verdes. Nesta auditoria, "teste concorrente real" significa **threads +
barreira (ou latch) + PostgreSQL real**; qualquer outra coisa está escrita como "só sequencial",
"só mock" ou "nenhum", mesmo quando o nome do teste diz "concorrente" (caso de
`AberturaCondicionalTest:126 segundaAberturaConcorrenteNaoDuplicaNemNotifica`, que chama duas vezes
em fila).

Os únicos testes concorrentes reais existentes no HEAD são:

- `ManutencaoPostgresIntegrationTest:entrarEmManutencaoEAbrirAutomaticamenteConcorrentesNuncaDeixamIncidenteOuNotificacaoOrfa`
  (HEAD `:227`, `@RepeatedTest(30)`, `CyclicBarrier`);
- `NotificacaoConcorrenciaPostgresIntegrationTest:duasTransacoesConcorrentesNaMesmaAncoraProduzemUmaUnicaLinha`
  (`:98`, dois `CountDownLatch` e confirmação de bloqueio no índice único);
- `NotificacaoConcorrenciaPostgresIntegrationTest:doisFecharConcorrentesFechamUmaVezEGeramUmaUnicaNotificacao`
  (`:164`, `CyclicBarrier`, execução única).

A Task 1, em andamento na árvore de trabalho no momento desta leitura (não commitada), acrescenta a
`ManutencaoPostgresIntegrationTest` os métodos `entrarEmManutencaoEFecharAutomaticamenteConcorrentesTerminamEmUmSoFechamento`
e `reconhecerEFecharAutomaticamenteConcorrentesNaoApagamReconhecimento`, ambos com `CyclicBarrier` e
30 repetições. A prova de reversão deles é responsabilidade do relatório da Task 1, não desta
auditoria.

## Critério de classificação

- **Alto** — um dos lados é o caminho do motor (processors de incidente/latência ou dispatcher de
  notificação: roda sozinho, sem humano) e o outro é uma escrita humana; não há guarda no banco; o
  desfecho corrompe dado ou notifica errado (mensagem a mais, a menos ou contraditória). Entra aqui
  também uma escrita humana que, **sem precisar de corrida**, deixa o motor silenciando alerta.
- **Médio** — duas ações humanas concorrentes sem guarda; ou guarda só por constraint, que chega ao
  usuário como 409 `DATA_INTEGRITY_VIOLATION` genérico ("Conflito de integridade dos dados",
  `TratadorGlobalDeErros.java:82-86`) ou como 500; ou espera de lock sem teto no motor
  (operacional).
- **Baixo** — guarda no banco presente mas sem teste concorrente real; ou guarda presente e testada
  (risco residual, marcado "coberto"); ou desfecho só cosmético; ou defeito latente sem código que o
  alcance hoje.

Dentro de cada nível, as linhas estão em ordem decrescente de gravidade.

## Mecanismo comum: UPDATE de linha inteira sem versão

`grep -rn "@Version\|DynamicUpdate" infra-monitor-backend/src/main/java` não devolve nada. Toda
escrita feita por *dirty checking* ou `saveAndFlush` vira `UPDATE <tabela> SET <todas as colunas
atualizáveis> WHERE id = ?`. Sob READ COMMITTED, se outra transação segura a linha, esse UPDATE
**espera** e, quando ela commita, grava por cima os valores que foram lidos **antes** — inclusive
colunas que a transação nem pretendia mudar. É esse o defeito de quase todas as linhas "nenhuma —
ler-depois-escrever" abaixo: não é só "último a escrever vence no campo que ele mudou", é "último a
escrever ressuscita a linha inteira como ele a leu".

As escritas que **não** têm esse defeito são os bulk updates condicionais (CAS) e os `INSERT ...
ON CONFLICT DO NOTHING`, listados com a guarda correspondente.

## Nota sobre números de linha

Arquivos citados com `:linha` foram lidos nesta auditoria. `IncidenteService.java` e
`IncidenteRepository.java` estão sendo editados pela Task 1 na árvore de trabalho; para eles, os
números são do **HEAD `d486441`** (conferidos com `git show HEAD:...`). O mesmo vale para
`ManutencaoPostgresIntegrationTest` (HEAD `:227`; na árvore de trabalho o método está em `:229`). Os
demais arquivos não tinham alteração em relação ao HEAD no momento da leitura.

## Tabela final, ordenada por risco

### Alto

| # | Escrita | arquivo:linha | Guarda no banco | Teste concorrente real? | Desfecho ilegítimo possível | Risco |
|---|---|---|---|---|---|---|
| A1 | Fechar incidente (manual) | `IncidenteService.java:150-162` (`saveAndFlush` `:160`) | **Nenhuma — ler-depois-escrever.** Lê a entidade, `fechar()`, UPDATE de linha inteira | Só `NotificacaoConcorrenciaPostgresIntegrationTest:doisFecharConcorrentesFechamUmaVezEGeramUmaUnicaNotificacao` (`:164`), que cobre apenas fechar × fechar e só afirma notificação única — o próprio javadoc do teste diz que a linha do incidente continua last-write-wins. Nada contra motor, manutenção ou reconhecer | (a) × `fecharAutomaticamente` já commitado: `motivo_encerramento` RECUPERACAO_AUTOMATICA → FECHAMENTO_MANUAL, `fechado_por` NULL → operador, `encerrado_em` trocado pelo do corpo; a `INCIDENTE_FECHADO` já existente absorve a segunda (uq V9:17), então o Telegram descreve recuperação e a linha diz fechamento manual. **Continua possível depois da Task 1**, cuja CAS é só do lado do motor. (b) × `entrarEmManutencao`: MANUTENCAO → FECHAMENTO_MANUAL e nascem `INCIDENTE_ENCERRADO_MANUTENCAO` **e** `INCIDENTE_FECHADO` (tipos distintos, o uq não barra) — dois avisos de encerramento. (c) × `reconhecer`: `reconhecido_em`/`reconhecido_por` voltam a NULL depois de `reconhecer` ter respondido sucesso (FECHADO sem reconhecimento é aceito por `ck_incidente_reconhecimento_coerente`, V16:37-39) | **Alto** |
| A2 | Encerrar episódio de latência por normalização (motor) | `LatencyEpisodeProcessor.java:118-120` | **Nenhuma — ler-depois-escrever** (`saveAndFlush` da entidade lida em `:66-67`) | Nenhum (`LatencyEpisodeProcessorTest:101` é com mocks) | × `entrarEmManutencao` (`encerrarPorManutencao` commitado): `motivo_encerramento` MANUTENCAO → NORMALIZACAO, `encerrado_em` trocado pelo da medição; nascem `LATENCIA_ENCERRADA_MANUTENCAO` **e** `LATENCIA_NORMALIZADA` — dois avisos. É o mesmo defeito que a Task 1 corrige no incidente, e a Task 1 não cobre o episódio | **Alto** |
| A2b | Notificar encerramento de episódio por manutenção (lado da manutenção) | `EquipamentoService.java:157-159` (lê `episodiosAfetadosIds`, depois `encerrarPorManutencao`) e `:177-178` (notifica todos os ids lidos) — linhas do código atual, depois de `1e44d9f` | **Nenhuma — ler-depois-escrever.** O bulk `encerrarPorManutencao` é `WHERE encerradoEm IS NULL`, mas a releitura de `:177` não filtra pelo motivo | Nenhum | É o segundo caminho do mesmo par de A2, e é o espelho do "segundo defeito" que a Task 1 achou no incidente (`riscos-execucao-correcoes.md` §1a). Se o `LatencyEpisodeProcessor` normaliza e **commita** entre a leitura de `:157` e o `encerrarPorManutencao` de `:159`, o bulk pula o episódio (já encerrado), mas `:177-178` chama `tratarEncerramentoPorManutencao` (`NotificacaoService.java:83-89`) para ele mesmo assim. Por leitura de código (não observado em teste): com a `LATENCIA_ALTA` já despachada, nasce `LATENCIA_ENCERRADA_MANUTENCAO` sobre uma linha que diz NORMALIZACAO; a `LATENCIA_NORMALIZADA` do motor sai também se o dispatcher já a tiver reservado, ou é cancelada por `cancelarPendentesDoEpisodio` (`NotificacaoRepository.java:107-110`, cancela toda PENDENTE do episódio) se ainda estiver PENDENTE — nos dois casos o aviso contradiz a linha. Precisa do mesmo filtro `motivoEncerramento == MANUTENCAO` que a Task 1 pôs na releitura de incidentes (`:174-176`). Um CAS só do lado do motor (direção de A2) **não** fecha este caminho: o motor ganhar a linha legitimamente é justamente o caso que produz o aviso a mais. **Não corrigido nesta rodada** (decisão de escopo do usuário: só os três riscos de execução) | **Alto** |
| A3 | Encerrar episódio em silêncio porque há incidente aberto (motor) | `LatencyEpisodeProcessor.java:72-78` (dirty checking, flush no commit da `REQUIRES_NEW` de `:57`) | **Nenhuma — ler-depois-escrever** | Nenhum | × `entrarEmManutencao`: `motivo_encerramento` MANUTENCAO → INCIDENTE e `encerrado_em` regravado; a `LATENCIA_ENCERRADA_MANUTENCAO` já criada passa a contradizer a linha. Janela estreita: exige incidente e episódio abertos ao mesmo tempo, estado que o próprio processor desfaz na primeira medição | **Alto** (janela estreita) |
| A4 | Decidir o aviso de encerramento na entrada em manutenção | `NotificacaoService.java:74-79` (incidente) e `:83-88` (episódio) | CAS no cancelamento (`NotificacaoRepository.java:100-110`, `WHERE status = PENDENTE`), **mas a decisão de criar o aviso vem da leitura anterior** (`:75`/`:84`) — ler-depois-escrever | Nenhum (o teste HEAD `:227` não tem thread do dispatcher) | O dispatcher reserva a abertura (PENDENTE → ENVIANDO, `NotificacaoRepository.java:78-81`) e commita entre `:75` e `:76`: `despachada` foi lido `false`, o cancelamento atualiza 0 linhas, a `INCIDENTE_ABERTO` sai para o Telegram e **nenhuma** `INCIDENTE_ENCERRADO_MANUTENCAO` é criada. O grupo recebe a abertura e nunca o encerramento. O comentário de `NotificacaoRepository.java:93-94` aceita a mensagem saindo, mas pressupõe o aviso — que depende de uma leitura feita antes. Idem para `LATENCIA_ALTA` / `LATENCIA_ENCERRADA_MANUTENCAO` | **Alto** |
| A5 | Mover monitor para outro equipamento | `MonitorService.java:76-93` (troca em `:79-81`) | **Nenhuma.** `obterEquipamentoAtivo` (`:131-136`) só olha `ativo`; a janela não é reavaliada | Nenhum (`InvarianteJanelaTest` não cobre `atualizar`) | **Não precisa de corrida.** (a) Monitor de equipamento em manutenção (janela fechada) movido para equipamento operando: volta a ser candidato (`MonitorRepository.java:35`) e é pingado, mas `IncidentProcessor.java:76-79` pula a abertura por falta de janela — falhas nunca viram incidente nem Telegram até alguém desativar e reativar o monitor. (b) Inverso: janela aberta, monitor deixa de ser candidato (`em_manutencao` do destino) — período de manutenção contado como observado sem medição. Correção do enunciado: "pode medir equipamento em manutenção" **não se confirma** no código — o filtro de candidatos lê o equipamento atual; o efeito real é na janela | **Alto** (determinístico, silencia alerta) |
| C1 | Fechar incidente automaticamente (motor) | `IncidenteService.java:101-114` (HEAD; `saveAndFlush` `:111`) | HEAD: **nenhuma — ler-depois-escrever** | HEAD: nenhum. Task 1: `entrarEmManutencaoEFecharAutomaticamenteConcorrentesTerminamEmUmSoFechamento` e `reconhecerEFecharAutomaticamenteConcorrentesNaoApagamReconhecimento` (não commitados no momento da leitura) | × `entrarEmManutencao`: MANUTENCAO → RECUPERACAO_AUTOMATICA, `fechado_por` → NULL, duas notificações de encerramento. × `reconhecer`: `reconhecido_*` → NULL | Alto — **corrigido nesta rodada (Task 1)**: CAS `IncidenteRepository.fecharAutomaticamenteSeEmAberto` (`WHERE id = :id AND status IN (ABERTO, RECONHECIDO)`), só colunas de fechamento; retorno 0 não notifica |

### Médio

| # | Escrita | arquivo:linha | Guarda no banco | Teste concorrente real? | Desfecho ilegítimo possível | Risco |
|---|---|---|---|---|---|---|
| M1 | Atualizar / ativar / desativar equipamento × entrar/sair de manutenção | `EquipamentoService.java:97-114`, `:117-128`, `:192-197`; `Equipamento.java:61-65` (sem `@Version`) | **Nenhuma.** O UPDATE de linha inteira espera o lock do CAS de `EquipamentoRepository.java:41-49` e depois grava o `em_manutencao` lido antes | Nenhum | `atualizar` lê `em_manutencao = false`; `entrarEmManutencao` commita (flag, incidentes fechados MANUTENCAO, janelas fechadas); o UPDATE de `atualizar` grava `em_manutencao = false`. O equipamento volta a ser candidato e é pingado **sem janela** — `IncidentProcessor.java:76-79` não abre incidente; a UI mostra fora de manutenção sem ninguém ter saído. Inverso com `sairDeManutencao`: `desativar`/`atualizar` regrava `em_manutencao = true` sobre janelas já reabertas. Primeiro da fila do médio pela consequência | **Médio** |
| M2 | Usuário: escritas sem lock × `atualizar`/`desativar` | `UsuarioService.java:29` (ativar), `:36` (resetarSenha), `:37-40` (trocarMinhaSenha), `:41` (registrarLogin, chamado por `AuthService.java:5`) | **Nenhuma.** Carregam sem lock; o UPDATE de linha inteira espera o `FOR UPDATE` de `:23`/`:32` e depois regrava `papel`/`ativo` antigos — o lock de `atualizar`/`desativar` não protege contra quem não o pede | Nenhum (não há teste de `UsuarioService`) | Admin desativa X enquanto X faz login (o `bcrypt` entre a leitura e o commit alarga a janela): o login regrava `ativo = true` e X segue com token válido (`JwtAuthenticationFilter` relê `ativo` e `papel` do banco a cada requisição). Admin rebaixa X de ADMIN durante o login de X: `papel` volta a ADMIN. `resetarSenha` × `trocarMinhaSenha`: uma das senhas se perde e `troca_senha_obrigatoria` fica da perdedora | **Médio** (segurança) |
| M3 | Ativar / desativar equipamento concorrentes (entre si ou com ativar/desativar monitor) | `EquipamentoService.java:117-128`, `:192-197`; `CicloJanelaMonitoramentoService.java:26-43` | **Nenhuma** — `ativo` last-write-wins; a janela é decidida sobre leitura | Nenhum (`InvarianteJanelaTest` e `MotorTemporalPostgresIntegrationTest:120` são sequenciais) | `ativo = true` com janelas fechadas (queda invisível: sem incidente, como em A5a) ou `ativo = false` com janela aberta (SLA conta silêncio administrativo) | **Médio** |
| M4 | Ativar / desativar monitor | `MonitorService.java:96-113` | **Nenhuma** | Nenhum (`MotorTemporalPostgresIntegrationTest:91` é sequencial) | Mesmo par de M3 por monitor. Também × `EquipamentoService.desativar`/`entrarEmManutencao`: `ativar` leu o equipamento ativo e fora de manutenção e abre janela depois que ele saiu do ar (`fecharEquipamento` não enxergou a janela ainda não commitada) — janela aberta sem candidato | **Médio** |
| M5 | Criar monitor × desativar/manutenção do equipamento | `MonitorService.java:48-57` | **Nenhuma** para a janela; FK `monitor → equipamento` RESTRICT (V5:17) contra exclusão | Nenhum | Mesma janela aberta sem candidato de M4. × `EquipamentoService.excluir`: a FK barra e o usuário recebe 409 genérico | **Médio** |
| M6 | Abrir janela | `CicloJanelaMonitoramentoService.java:26-29` | Ler-depois-escrever; **só** o índice parcial `uq_janela_monitoramento_aberta` (V13:10) | Nenhum | Duas aberturas simultâneas (duplo clique em ativar monitor; ativar equipamento × `sairDeManutencao`; ativar equipamento × ativar monitor): o segundo INSERT espera e estoura o índice → `DataIntegrityViolationException` → 409 `DATA_INTEGRITY_VIOLATION` genérico e rollback da ação inteira, que para o usuário era idempotente | **Médio** |
| M7 | Abrir incidente manual | `IncidenteService.java:49-64` (HEAD) | `existsBy` + índice parcial `uq_incidente_monitor_aberto` (V16:48-49), convertido em 409 com mensagem própria (`:61-63`) | Nenhum | Não valida `ativo` nem `em_manutencao` (nem em sequência). × `entrarEmManutencao`: `abertosDoEquipamento` não enxerga o INSERT não commitado — o incidente sobrevive ABERTO dentro da manutenção, com `INCIDENTE_ABERTO` a despachar | **Médio** |
| M8 | Conexão de hub (definir) | `UnidadeService.java:109-121`; varredura `:138-149` | **Nenhuma para ciclo** — `ck_unidade_conexao_nao_reflexiva` (V18:19-20) só barra A→A; FK `fk_unidade_conecta_a` (V18:14) | Só mock (`UnidadeServiceTest:263 recusaConexaoQueFechaCiclo`, Mockito) | A→B e B→A simultâneos passam as duas varreduras: ciclo A↔B gravado. Depois disso, toda varredura que passa pela cadeia estoura o teto e responde "excede a profundidade suportada" (`:146-147`). × exclusão do destino: FK → 409 genérico | **Médio** |
| M9 | Escrita de linha inteira de unidade (atualizar, ativar, desativar, remover/definir conexão) | `UnidadeService.java:63-99`, `:125-129`, `:152-163` | **Nenhuma** | Nenhum | `atualizar` lido com `conecta_a_unidade_id = NULL` regrava NULL sobre um `definirConexao` commitado — o enlace some do mapa; idem nome, sigla, coordenadas | **Médio** |
| M10 | Criar usuário / trocar e-mail | `UsuarioService.java:18-21`, `:25` | `existsBy` + `uq_usuarios_email_lower` (V12:20) | Nenhum | Dois cadastros com o mesmo e-mail: o segundo recebe 409 `DATA_INTEGRITY_VIOLATION` genérico em vez de "Já existe um usuário com este e-mail" | **Médio** |
| M11 | Excluir equipamento / tipo / unidade × criação de filho | `EquipamentoService.java:200-206`, `TipoEquipamentoService.java:74-80`, `UnidadeService.java:166-177` | `exists` + FK RESTRICT (V2:108, V2:110, V5:17, V18:14) | Nenhum | 409 genérico em vez da mensagem de negócio; nenhum órfão | **Médio** |
| C2 | Esperas de lock no motor | `IncidenteRepository.java:86-96` (HEAD), `MonitorEpisodioLatenciaRepository.java:33-43`, e os fechamentos que disputam linha com `entrarEmManutencao` | `FOR UPDATE OF e` **sem `lock_timeout`** (não há `lock_timeout` nem `statement_timeout` em `application.yml`) | Nenhum no HEAD. Depois da Task 2: `LockTimeoutMotorPostgresIntegrationTest`, dois métodos (um por processor), cada um com thread real segurando `FOR UPDATE` na linha do equipamento por 8 s, latch e Postgres real; reversão de cada `aplicarNaTransacaoCorrente` vai a ~8000 ms e falha. Cobre só a espera na abertura (`inserirSeElegivel`), não a dos fechamentos | Worker do motor e conexão presos enquanto outra transação segurar a linha do equipamento; pool de 10 com pico de segundo plano de 10 (o desenho dizia 11; a leitura do código na seção 1b de `riscos-execucao-correcoes.md` achou scheduler e poll do dispatcher na mesma thread) | Médio (operacional) — **corrigido nesta rodada (Task 2)**: `set_config('lock_timeout', '2000ms', true)` como primeira instrução das duas `REQUIRES_NEW`; estouro pula o ciclo com WARN; pool default 20 |
| C3 | Excluir monitor | `MonitorService.java:116-128` | `exists` de medição/incidente + `apagarDoMonitor` (bulk delete) + FK RESTRICT (`medicao` V6:17, `janela_monitoramento` V13:3) | **Só sequencial**: `ExclusaoEJanelaPostgresIntegrationTest` (Testcontainers, Postgres real, mas uma thread só — prova a exclusão com janela e as recusas, não a corrida). A corrida medição × exclusão é guardada pela FK de `medicao` (rollback → 409), mas **não há teste de corrida real** que a prove | Antes: `criar`/`ativar` abrem janela e a FK de V13:3 é `ON DELETE RESTRICT`, então excluir um monitor que já teve janela **falhava** com 409 `DATA_INTEGRITY_VIOLATION` genérico — na prática só se excluía monitor que nunca tivera janela. Medição do motor entre a guarda e o DELETE: FK de `medicao` → 409, sem órfão | Médio — **corrigido nesta rodada (Task 3)**: `JanelaMonitoramentoRepository.apagarDoMonitor` (`CicloJanelaMonitoramentoService.java`) antes do `delete`, na mesma transação |

### Baixo

| # | Escrita | arquivo:linha | Guarda no banco | Teste concorrente real? | Desfecho ilegítimo possível | Risco |
|---|---|---|---|---|---|---|
| B1 | Esperas de lock sem teto no caminho HTTP | `UsuarioRepository.java:13-18` (`PESSIMISTIC_WRITE` sem hint de timeout); `EquipamentoRepository.java:41-44` (CAS de `entrarEmManutencao`) | Lock presente, **sem `lock_timeout`**; `application.yml:12-18` só define `maximum-pool-size`. A Task 2 cobre só o motor | Nenhum | Requisição HTTP e conexão presas enquanto outra transação segurar a linha; poucas bastam para faltar conexão ao motor. Sem dado errado | Baixo (operacional) |
| B2 | Abrir incidente automático (motor) | `IncidenteRepository.java:86-96` (HEAD); `IncidenteService.java:82-98` (HEAD) | `INSERT ... SELECT ... FOR UPDATE OF e` + `ON CONFLICT DO NOTHING` + predicado de elegibilidade | **Sim**: `ManutencaoPostgresIntegrationTest:entrarEmManutencaoEAbrirAutomaticamenteConcorrentesNuncaDeixamIncidenteOuNotificacaoOrfa` (HEAD `:227`, 30×). `AberturaCondicionalTest:126` é só sequencial apesar do nome | Nenhum com a guarda atual; espera sem teto é C2 | Baixo (coberto) |
| B3 | Inserir notificação pendente | `NotificacaoRepository.java:40-53` | `ON CONFLICT DO NOTHING` (`uq_notificacao_incidente_canal_evento` V9:17, `uq_notificacao_episodio_canal_evento` V15:64) | **Sim**: `NotificacaoConcorrenciaPostgresIntegrationTest:duasTransacoesConcorrentesNaMesmaAncoraProduzemUmaUnicaLinha` (`:98`) | Nenhum na mesma âncora e tipo. Tipos distintos não se barram — é por isso que A1b e A2 geram dois avisos | Baixo (coberto) |
| B4 | Fechar incidentes por manutenção | `IncidenteRepository.java:115-124` (HEAD) | Bulk CAS `status IN (ABERTO, RECONHECIDO)` | Sim, via HEAD `:227` (e o teste novo da Task 1) | Nenhum pela CAS; o dano vem de quem regrava depois (A1, C1) | Baixo (coberto) |
| B5 | Entrar em manutenção (flag) | `EquipamentoRepository.java:41-44`; `EquipamentoService.java:143-174` | CAS `em_manutencao = false` | Sim, via HEAD `:227`. `EntradaEmManutencaoTest:112` ("duas vezes") é só sequencial | Nenhum pela CAS; os riscos da operação estão em A4, M1 e B1 | Baixo (coberto) |
| B6 | Reconhecer incidente | `IncidenteRepository.java:56-60`, `IncidenteService.java:171-183` (HEAD) | CAS `status = ABERTO` | HEAD: nenhum; Task 1: `reconhecerEFecharAutomaticamenteConcorrentesNaoApagamReconhecimento` | A CAS não protege contra quem regrava a linha depois (A1c) | Baixo |
| B7 | Sair de manutenção | `EquipamentoRepository.java:46-49`; `EquipamentoService.java:182-189` | CAS `em_manutencao = true` | Só sequencial (`EntradaEmManutencaoTest:150`, `:158`) | Reabertura concorrente de janela cai em M6 | Baixo |
| B8 | Abrir episódio de latência (motor) | `MonitorEpisodioLatenciaRepository.java:33-43`; `LatencyEpisodeProcessor.java:96-107` | `FOR UPDATE OF e` + `ON CONFLICT DO NOTHING` (`uq_monitor_episodio_latencia_aberto`, V15:28-29) | Só sequencial (`AberturaCondicionalTest:115`) | Nenhum com a guarda; espera sem teto é C2 | Baixo |
| B9 | Encerrar episódios por manutenção | `MonitorEpisodioLatenciaRepository.java:53-58` | Bulk `WHERE encerradoEm IS NULL` | Nenhum (`EntradaEmManutencaoTest:130` é sequencial) | O bulk é seguro; o dano vem de A2/A3 regravando depois | Baixo |
| B10 | Reservar / devolver travadas / completar notificação (dispatcher) | `NotificacaoRepository.java:78-86`; `NotificationDispatchStateService.java:18-31` | `reserve` é CAS; `complete` lê "é ENVIANDO?" e regrava por dirty checking | Só mock (`NotificationDispatcherTest` mocka o `stateService`) | Worker que passe de `processing-timeout-ms` (60 s, `application.yml:119`) entre `reserve` e `complete`: `releaseStaleSending` devolve a PENDENTE, outro worker reserva e **reenvia** — Telegram duplicado; o `complete` do primeiro marca ENVIADA a reserva do segundo. Com timeouts HTTP de 3 s + 5 s (`application.yml:105-106`), só com pausa de JVM ou banco | Baixo |
| B11 | Cancelar notificações pendentes | `NotificacaoRepository.java:100-110` | CAS `status = PENDENTE` | Nenhum | O cancelamento é seguro; a decisão do aviso é A4 | Baixo |
| B12 | Usuário: atualizar papel / desativar (último ADMIN) | `UsuarioService.java:22-35`, `:44`; `UsuarioRepository.java:13-18` | `PESSIMISTIC_WRITE` em todos os ADMIN ativos + no alvo | Nenhum | Dois `desativar` de admins distintos serializam em `lockActiveAdmins`; a releitura de `:44` vê o commit anterior. Sem furo encontrado dentro do próprio par; o furo está em M2 | Baixo |
| B13 | Fechar janela (monitor / equipamento) | `CicloJanelaMonitoramentoService.java:31-32`; `JanelaMonitoramento.java:15` | Nenhuma (dirty checking em `fim_em`) | Nenhum | Dois fechamentos simultâneos: `fim_em` fica com o instante do último, milissegundos depois | Baixo (cosmético) |
| B14 | Tipo de equipamento: atualizar / ativar / desativar | `TipoEquipamentoService.java:47-71` | Nenhuma, linha inteira | Nenhum | Last-write-wins em nome/descrição/ativo. × `EquipamentoService.criar` (lê tipo ativo): equipamento com tipo inativo — estado também alcançável em sequência, porque desativar tipo não cascateia | Baixo (cosmético) |
| B15 | Unidade ativar/desativar × criar/ativar equipamento | `UnidadeService.java:152-163`; `EquipamentoService.java:119-121`, `:226-233` | Nenhuma | Nenhum | Equipamento ativo em unidade inativa; também alcançável em sequência, e o motor não filtra `unidade.ativo` (`MonitorRepository.java:35`) | Baixo (cosmético) |
| B16 | Gravar medição (motor) | `MedicaoService.java:43-50` (HEAD) | Nenhuma: INSERT sem predicado; candidato lido antes (`MonitorExecutionCoordinator.java:49`) | Nenhum | Medição com `executado_em` depois da entrada em manutenção ou da desativação; a abertura é barrada por B2/B8 e a janela já está fechada | Baixo |
| B17 | Candidatos e aberturas não filtram `deleted_at` | `MonitorRepository.java:29-38`; `IncidenteRepository.java:91` (HEAD); `MonitorEpisodioLatenciaRepository.java:38` | Não se aplica | Nenhum | Latente: **nenhum código Java lê ou grava `deleted_at`** (coluna em V2:29, :62, :95). Uma exclusão lógica futura, ou feita à mão no banco, continuaria pingada e abrindo incidente | Baixo (latente) |

## Achados fora da escala

- **Exclusão lógica não existe.** `deleted_at` está nas três tabelas de inventário desde a V2 e
  entra nos índices únicos parciais (V2:45, :49, :70, :72, :115, :118), mas nenhuma classe Java a
  referencia. "Excluir" hoje é sempre `DELETE` físico, barrado por FK quando há filhos.
- **Log do dispatcher para notificação de episódio.** `NotificationDispatcher.java:68` e `:70`
  chamam `notification.getIncidente().getId()`; em notificação ancorada em episódio `getIncidente()`
  é nulo, o `NullPointerException` cai no `catch` de `:71-73`, que chama `complete` com falha — no
  caminho de sucesso é no-op (a linha já está ENVIADA), mas registra ERROR espúrio. Não é
  concorrência; registrado porque apareceu na leitura.

## Nada foi corrigido além do item 1

Esta auditoria não alterou código. As únicas correções da rodada são as do item 1 do desenho
(C1 — Task 1, C2 — Task 2, C3 — Task 3). Tudo o mais abaixo está para decisão de escopo.

Lista priorizada (direção provável entre parênteses, não decisão):

1. **A1** fechar manual — CAS no idioma de `reconhecerSeAberto` (`WHERE status IN (ABERTO,
   RECONHECIDO)`), só colunas de fechamento; retorno 0 sem notificação.
2. **A2, A2b, A3** encerramentos de episódio — do lado do motor (A2, A3), bulk `WHERE id = ? AND
   encerrado_em IS NULL`, mesmo idioma de C1; do lado da manutenção (A2b), filtrar a releitura por
   `motivoEncerramento == MANUTENCAO`. As duas metades são necessárias, como foram no incidente.
3. **A4** aviso de encerramento na manutenção — decidir o aviso a partir do estado **depois** de
   travar/cancelar, e não de uma leitura anterior.
4. **A5** mover monitor — reavaliar a janela na origem e no destino dentro de `atualizar`.
5. **M1, M2** UPDATE de linha inteira em `Equipamento` e `Usuario` — versão otimista ou escritas
   pontuais condicionais; M2 tem consequência de segurança.
6. **M3–M6** invariante da janela sob corrida — hoje só vale em sequência.
7. **M7–M11** — guardas faltando ou 409 genérico.
8. **B1** `lock_timeout` também no caminho HTTP.
9. Restante do baixo — nenhum dado errado com as guardas atuais; falta teste concorrente real.
