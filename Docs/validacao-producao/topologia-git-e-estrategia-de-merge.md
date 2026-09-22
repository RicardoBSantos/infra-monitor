# Topologia do git e estratégia de merge — branch `fix/icmp-nativo-windows`

Data: 2026-09-22. Documento só de leitura de histórico. **Nenhum comando de merge, rebase, push,
reset ou checkout de branch foi executado para produzir este documento** — só `git log`, `git branch`,
`git diff --stat`, `git ls-tree` e `git show`.

## 1. O que "`main..HEAD` traz N arquivos" quer dizer

`git diff --stat main..HEAD` compara a ponta da `main` com a ponta deste branch e lista **todo arquivo
que é diferente entre as duas pontas** — criado, apagado ou alterado, não importa em qual dos dois
lados a diferença nasceu. Isso **não é o número de arquivos que este branch mexeu**. É o tamanho da
distância entre os dois pontos.

A `main` local está parada em um único commit, a fundação do backend (Spring Boot, PostgreSQL, Flyway,
sem CRUD de negócio). Todo o resto do projeto — Mapa, Incidentes, Relatórios, Autenticação, motor ICMP,
Notificações, Unidades, Equipamentos, e o frontend Angular inteiro — foi construído depois desse ponto,
em branches de trabalho. Por isso quase o projeto inteiro aparece como "diferença": não é que este
branch tenha tocado 752 arquivos de trabalho aqui dentro, é que a `main` ficou parada muito atrás e o
branch percorreu praticamente toda a distância sozinho.

Comando e resultado, na íntegra:

```
$ git diff --stat main..HEAD | tail -1
752 files changed, 136636 insertions(+), 79 deletions(-)

$ git log --oneline main..HEAD | wc -l
84
```

### Achado que muda a leitura: a `main` local está desatualizada em relação à `origin/main`

`git branch -vv` mostra `main [origin/main: behind 4]`: a `main` local não é a "main real" mais
recente — ela está 4 commits atrás do que já existe em `origin/main`. Ninguém rodou `git fetch`/`pull`
na `main` local depois que a PR `feat/inventario-migration` foi mesclada no GitHub.

```
$ git log --oneline main..origin/main
c7bbe66 Merge pull request #1 from RicardoBSantos/feat/inventario-migration
633d9c6 feat: prepara API para integracao Angular
a0a3ebf feat: adiciona monitoramento, incidentes e notificacoes
ae25a84 feat(db): migration do módulo de inventário
```

Ou seja: **`origin/main` já é ancestral direto deste branch** (`git merge-base --is-ancestor
origin/main HEAD` → `YES`). O trabalho de inventário (unidade/tipo/equipamento), o motor de
monitoramento/incidentes/notificações no backend e a preparação de API já foram integrados à `main`
real via aquela PR — só a cópia local do ponteiro `main` é que não foi atualizada.

Usando a `main` real (`origin/main`) em vez da cópia local desatualizada, a distância cai bastante:

```
$ git diff --stat origin/main..HEAD | tail -1
684 files changed, 105194 insertions(+), 342 deletions(-)

$ git log --oneline origin/main..HEAD | wc -l
80
```

Isso não muda a conclusão principal (a distância continua enorme, e a `main` continua sem frontend
nenhum — ver seção 4), mas é o número certo a usar numa decisão de merge. Comparar contra a `main`
local desatualizada infla a distância artificialmente em ~68 arquivos e 4 commits que já não são
diferença real.

**Recomendação prática, sem executar nada aqui:** antes de decidir a estratégia de merge, alguém deve
rodar `git fetch origin && git checkout main && git merge --ff-only origin/main` (fast-forward puro,
sem risco, sem conflito possível) para que a `main` local passe a refletir a `main` real do GitHub.
Esta tarefa não faz isso porque está restrita a comandos de leitura.

## 2. `git log --oneline --graph --decorate -40`

```
* 75985a6 (HEAD -> fix/icmp-nativo-windows) docs(icmp): colher evidencia real de motor ligado na secao A.1
* 6a58458 fix(monitoring): remover bean monitoringClock duplicado no motor
* d10412e fix(icmp): tentar a carga nativa tambem com o motor desligado
* 9717b3e docs(plano): fechamento do branch ICMP e manutencao de equipamento
* 805e3c4 docs(desenho): fechamento do branch ICMP e manutencao de equipamento
* d6a3b16 docs(validacao): relatorio final da revisao do branch fix/icmp-nativo-windows
* 36c3e4c docs(icmp): corrigir afirmacoes que a propria onda de correcao tornou falsas
* 2293b8c docs(icmp): atualizar evidencia colada, CLAUDE.md e registrar divida de binding relaxado
* c008def fix(icmp): corrigir comentario obsoleto, vazamento de path e invariante nao garantida
* 513037a docs(validacao): corrigir citacoes de linha erradas na Parte A
* ceb8ea2 docs(validacao): corrigir o tipo de equipamento.ip_address e completar a Parte A
* bdb55a8 test(icmp): medir a maior mensagem gerada contra o limite de medicao.mensagem
* f513128 feat(status): publicar a implementacao ICMP ativa em /api/v1/status
* 69ed6f4 fix(icmp): carregar a biblioteca nativa uma vez na subida, nao por sondagem
* 3a4dce7 fix(pools): rotular a tarefa e embrulhar os dois executores
* 83f1aa4 fix(pools): envelope que impede falha de tarefa de sumir no Future
* 0bdc20b docs(icmp): plano de implementacao da revisao do branch
* d3ed76c docs(icmp): desenho da revisao do branch fix/icmp-nativo-windows
* 550223c fix(icmp): onda final da revisao do branch - jna, handle, join e parser
* b35eddd test(icmp): prova de reversao cobrindo a fiacao do runner, nao so o parser
* 68ef3c7 docs(validacao): registrar os falsos positivos do ICMP e a decisao pela JNA
* c970cbd fix(icmp): indiretar excludedGroups do surefire por propriedade maven
* 82584ca test(icmp): prova de reversao e sondagem contra a rede real
* e2c355c fix(icmp): logar falha da camada nativa antes de devolver ERRO
* 305f363 feat(icmp): escolher a implementacao por monitoring.icmp.implementacao
* 1c12075 feat(icmp): sondagem nativa no Windows via IcmpSendEcho
* ca98687 fix(icmp): provar com teste que a thread leitora nao prende o chamador
* 0dd1828 fix(icmp): ler stdout do ping em thread daemon separada
* a5f8254 chore: ignorar o workspace efemero do .superpowers/
* 11b1fc8 docs(manutencao): proposta de desenho do equipamento em manutencao
* 68c6d77 fix(icmp): decidir pelo status ICMP em vez do codigo de saida do ping
* 7cab508 (feat/unidade-hub) docs(mapa): corrige três comentários com número/cor obsoletos pós-D19
* 2185a64 docs(e2e): corrige comentário desatualizado no caso 10 do n07
* aa89abb test(e2e): evidência do marcador sem aro, pulso geral e anel por status
* 9a1dbe5 docs(mapa): corrige a última irmã do presente sem âncora em §8 (halo do marcador)
* ee932fd docs(mapa): corrige presente sem âncora temporal na frase do lilás em §11
* 45aac9f docs(mapa): registra D19 e as duas reversões de N07
* ca972ae feat(mapa): anel de seleção na cor do status
* bf69910 feat(mapa): pulso em todos os marcadores de unidade
* 06f9768 feat(mapa): marcador sem aro claro, com os dois status neutros clareados
```

Leitura do grafo: é uma linha reta (`*` sem bifurcação nesses 40 commits), sem merges locais. O ponto
`7cab508` é onde o ponteiro `feat/unidade-hub` está parado hoje — os commits deste branch depois desse
ponto (de `68c6d77` até o topo) foram feitos diretamente em `fix/icmp-nativo-windows`, não em
`feat/unidade-hub`. `feat/unidade-hub` é um ancestral, não uma linha paralela ativa.

Commits ahead da `main` local (`main..HEAD`): **84**. Commits ahead da `main` real (`origin/main..HEAD`):
**80**.

## 3. `git branch -a`

```
  feat/inventario-migration
  feat/unidade-hub
* fix/icmp-nativo-windows
  main
+ spike/n01-maplibre
  remotes/origin/HEAD -> origin/main
  remotes/origin/feat/inventario-migration
  remotes/origin/main
```

- `feat/inventario-migration` — **tem correspondente em `origin`** (`origin/feat/inventario-migration`,
  idêntico ao local: `0 commits` de diferença nos dois sentidos). Já foi mesclado em `origin/main` via
  PR #1 e é ancestral direto de `HEAD` (`git merge-base --is-ancestor feat/inventario-migration HEAD` →
  `YES`). Não é um branch "solto" — é histórico já integrado.
- `feat/unidade-hub` — **local, sem correspondente em `origin`**. É um ancestral direto de `HEAD`
  (o commit `7cab508` aparece no grafo de `fix/icmp-nativo-windows` acima). Não representa trabalho
  paralelo pendente de decisão; é só um ponteiro antigo que ficou para trás no mesmo branch de fato.
- `spike/n01-maplibre` — **local, sem correspondente em `origin`**, com o worktree apontado em
  `C:/Users/rbfilho/Documents/infra-monitor-n01-spike`. Foi deliberadamente mantido fora do repositório
  de trabalho principal (decisão registrada em memória do projeto: nada do spike entra no branch antes
  de um gate). **Não deve ser tratado como trabalho a integrar** nesta rodada.
- `main` (local) — desatualizada, 4 commits atrás de `origin/main` (ver seção 1).

## 4. Tabela: frente de trabalho × está na `main`? × onde está

A coluna "main" usa `origin/main` (a main real), não a cópia local desatualizada.

| Frente de trabalho | Está em `origin/main`? | Onde está |
|---|---|---|
| **Unidades** (backend: unidade/tipo_equipamento) | Sim | `infra-monitor-backend/.../unidade` — veio da PR `feat/inventario-migration` |
| **Equipamentos** (backend: entidade, CRUD) | Sim | `infra-monitor-backend/.../equipamento` — mesma PR |
| **ICMP** (motor de monitoramento, mas só Linux) | Parcial | `infra-monitor-backend/.../monitoring/icmp` tem `IcmpMonitorExecutor`, `LinuxPingCommandRunner`, coordenador e agendador. **Não tem** a implementação nativa Windows (JNA/`IcmpSendEcho`) — isso é exclusivo deste branch |
| **Incidentes** (backend: processamento) | Parcial | `monitoring/incident/IncidentProcessor` existe no backend. **Não há tela de incidentes** — frontend Angular inteiro está ausente de `origin/main` |
| **Notificações/Telegram** (backend) | Parcial | Presente no pacote de monitoramento/notificação do backend. Sem frontend, sem tela de configuração de canal |
| **Mapa** (MapLibre) | Não | Existe só neste branch, em `infra-monitor-frontend/src/app/features/mapa` |
| **Relatórios** (PDF/CSV) | Não | Existe só neste branch — backend de relatórios e frontend, nenhum dos dois em `origin/main` |
| **Autenticação/JWT** | Não | `infra-monitor-backend/.../auth` e `Docs/auth-architecture/` só existem neste branch |
| **Frontend Angular (como um todo)** | Não | `origin/main` não tem o diretório `infra-monitor-frontend/` — é backend-only até hoje |

Resumo em uma frase: `origin/main` tem a fundação do backend + inventário (unidade/equipamento) + um
motor de monitoramento/incidentes/notificações que roda só em Linux. Tudo que depende de frontend
(Mapa, Relatórios, Incidentes na tela, Notificações na tela) e tudo de Autenticação está **inteiramente**
fora da `main`, só existe neste branch.

## 5. Proposta de estratégia de merge

Três opções avaliadas. **Nenhuma foi executada.**

### Opção A — Merge direto do branch longo (`fix/icmp-nativo-windows` → `main`, um merge só)

- **Como seria:** um único `git merge fix/icmp-nativo-windows` trazendo os ~684 arquivos de diferença
  (contra `origin/main`) de uma vez.
- **Riscos:**
  - Um merge de 80 commits e ~105 mil linhas é impossível de revisar de verdade num PR só; qualquer
    problema introduzido em algum ponto do meio (ex.: a remoção do bean `monitoringClock` duplicado,
    commit `6a58458`) fica escondido dentro de um diff gigante.
  - Se algo quebrar em produção depois do merge, não há como isolar "foi o Mapa ou foi o Auth" sem
    reverter tudo.
  - Concentra meses de trabalho de frentes completamente diferentes (Mapa, Auth, Relatórios, ICMP) num
    único ponto de decisão "vai ou não vai".

### Opção B — Série de merges por frente de trabalho

- **Como seria:** recortar o branch em fatias por assunto (Unidades/Equipamentos já está coberto pela
  `main`; depois Auth; depois ICMP com o adendo Windows; depois Mapa; depois Incidentes+Notificações;
  depois Relatórios), cada fatia virando um PR revisável separadamente contra a `main` atualizada.
- **Riscos:**
  - O código não foi desenvolvido em fatias isoladas — os 80 commits deste branch já misturam assunto
    (ex.: commits de `icmp` e de `pools`/`monitoring` intercalados, ver seção 2). Recortar por
    cherry-pick depois do fato é trabalho manual sujeito a erro e pode gerar conflitos que não existiam
    na ordem original.
  - Frentes têm dependência entre si (o motor ICMP evoluiu depois que Unidades/Equipamentos já
    existiam; o Mapa depende de Unidades ter coordenadas). Fatiar errado quebra a ordem de dependência.
  - Mais lento — cada fatia é uma rodada de revisão e merge própria.

### Opção C — Rebase do branch sobre a `main` atualizada, depois um único merge/PR

- **Como seria:** `git rebase origin/main` no branch de trabalho (reescrevendo os 80 commits sobre a
  ponta real da `main`), resolvendo os conflitos uma vez, e então abrir um PR do branch resultante.
- **Riscos:**
  - Rebase de 80 commits com potencial de conflito em `infra-monitor-backend/` (onde `origin/main` e
    este branch divergiram de fato — ambos mexeram em monitoramento/incidentes) é trabalho pesado e
    arriscado de fazer sem quebrar histórico já compartilhado.
  - Reescreve os hashes de commit deste branch; se alguém mais tiver algo baseado nele (não é o caso
    hoje, mas vale registrar), quebra.
  - Não resolve o problema de revisão: ainda termina em um PR gigante, só que com histórico "limpo".

### Recomendação

**Opção B (série de merges por frente), mas com um passo zero primeiro: atualizar a `main` local via
fast-forward puro (`git fetch && git merge --ff-only origin/main`), sem que isso conte como decisão de
merge deste branch.** Depois disso:

1. Auth e ICMP-Windows-nativo são as duas frentes de maior risco técnico (a primeira por segurança, a
   segunda porque é literalmente o assunto que este branch corrigiu) — devem ser os primeiros PRs,
   revisados a sós.
2. Mapa, Incidentes (tela) e Notificações (tela) dependem umas das outras via o frontend Angular
   inteiro que ainda não existe na `main` — provavelmente precisam entrar juntas como "PR do frontend
   base + Mapa" e depois PRs incrementais.
3. Relatórios pode vir por último, é a frente mais isolada (consome dados que as outras já expõem).

Motivo da recomendação: o branch já tem 80 commits de histórico granular e semanticamente nomeado
(`fix(icmp)`, `feat(mapa)`, `docs(validacao)` etc. — ver a contagem por prefixo abaixo) que já sugere
onde cortar; aproveitar essa granularidade existente é mais barato do que reescrever histórico (Opção
C) e mais seguro de revisar do que engolir tudo de uma vez (Opção A). O custo de fatiar (Opção B) é
real, mas é trabalho de organização — não de reescrita de código nem de histórico já publicado.

Contagem de commits por prefixo/escopo (`main..HEAD`, campo entre parênteses do `subject`), para
apoiar o corte por frente:

```
     19 icmp
     13 mapa
      7 unidades
      5 ui
      4 validacao
      4 e2e
      3 screenshots
      3 relatorios
      3 incidentes
      2 pools
      1 telegram
      1 status
      1 monitoring
      1 manutencao
      1 latencia
      1 gaveta
      1 equipamentos
      1 db
      ...
```

## 6. Nada foi executado

**Este documento é só leitura e proposta.** Nenhum `merge`, `rebase`, `push`, `reset` ou `checkout` de
branch foi rodado para produzi-lo. A `main` local segue exatamente como estava (a atualização por
fast-forward descrita na seção 1 é uma recomendação para outro passo, não algo que esta tarefa
executou). A decisão de qual estratégia seguir — e quando — é do humano responsável pelo branch.
