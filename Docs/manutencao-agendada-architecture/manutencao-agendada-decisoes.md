# Manutenção agendada — log de decisões

Ordem de decisão. Cada entrada: o que foi decidido, o que foi descartado e por quê. Estado de todas
em 2026-10-22: **propostas no desenho, não implementadas.** Detalhes em
[manutencao-agendada-desenho.md](manutencao-agendada-desenho.md).

---

## MA01 — `em_manutencao` vira estado efetivo materializado; botão ganha coluna própria

`manutencao_manual` guarda o botão; `em_manutencao = manutencao_manual OR coberto por janela ATIVA`,
com `CHECK (NOT manutencao_manual OR em_manutencao)`.

Razão: `em_manutencao` é lido por motor, dois INSERTs condicionais, M7, janela de SLA e painel, e o
lock da linha do equipamento é o ponto de serialização de todas as corridas já resolvidas (A1/A2, M7).
Materializar mantém esses pontos intocados e o CAS numa linha só.

**Descartado: predicado derivado em todas as queries** (`em_manutencao OR EXISTS(janela ativa)`).
~10 pontos para mudar juntos, invariante de `CicloJanelaMonitoramentoService` exposta a deriva, e os
INSERTs condicionais passariam a depender de linhas de outra tabela que o `FOR UPDATE OF e` não trava.

**Descartado: o reconciliador liga e desliga o mesmo flag do botão.** Fim da janela desligaria uma
manutenção manual em curso — exatamente o caso proibido.

**Alternativa registrada, não escolhida agora:** o botão manual vira uma janela sem fim
(`fim_previsto NULL`, escopo de um equipamento). Ganha histórico, autor e motivo para o manual (P-03),
mas reescreve o caminho recém-entregue no PR #17 e complica CHECKs e tela. Fica possível depois sem
quebrar nada: `manutencao_manual` pode ser migrado para janelas abertas.

---

## MA02 — Sem código `MW-NNNN`; identificador é o `id`

Mostrado como `#41`, igual a incidentes e notificações.

**Descartado: sequência persistida com prefixo.** O mockup a fabrica no front a partir do tamanho do
array (mesmo padrão do `INC-2026-00192` de mockups anteriores, que também não virou sequência).
Coluna de código seria uma segunda identidade a manter única, sem consumidor externo que a exija.

---

## MA03 — Tabela nova `manutencao_agendada`; `janela_monitoramento` não é reutilizada

`janela_monitoramento` é elegibilidade temporal do SLA, por monitor, uma aberta por vez, com
`origem PRECISA/INFERIDA`. A manutenção é uma das **causas** de ela fechar.

**Descartado: reutilizar `janela_monitoramento`.** Exigiria afrouxar `uq_janela_monitoramento_aberta`,
pendurar motivo/autor/escopo numa tabela por monitor e misturar "não observado" com "planejado" no
cálculo de disponibilidade.

**Descartado: nome `janela_manutencao`.** A uma palavra de `janela_monitoramento`; o próprio pedido do
ciclo precisou avisar que as duas não têm relação.

---

## MA04 — Sobreposição de janelas é permitida

Com efetiva = OR, sobreposição não tem efeito ruim, e é caso real (unidade + equipamento na mesma
noite). Também é como se prorroga na F1: nova janela começando agora.

**Descartado: `EXCLUDE USING gist` com `tstzrange`.** Exige `btree_gist`, e não expressa sobreposição
entre escopo de unidade e escopo de equipamento da mesma unidade. Bloquearia o caso legítimo.

---

## MA05 — Escopo `UNIDADE` é dinâmico; `EQUIPAMENTOS` é por id

`UNIDADE` é avaliado a cada vez pelo predicado de cobertura: equipamento criado ou movido para a
unidade durante a janela entra; movido para fora sai. `EQUIPAMENTOS` segue o id, mesmo que o
equipamento mude de unidade. `criar` e `atualizar` chamam `reavaliar`.

Não depende de `unidade.ativo`: a janela age sobre cada equipamento.

**Descartado: congelar a lista na ativação.** "Unidade inteira" deixaria de ser a unidade inteira, e
um equipamento instalado durante a obra seria pingado e alarmaria.

---

## MA06 — Reconciliador por nível, único dono do relógio

Tick de 30 s + passada na subida: CAS de status (ativar, expirar, concluir) e correção de toda
divergência `em_manutencao ≠ desejado`. O predicado de cobertura olha `status = 'ATIVA'`, nunca `now()`.

**Descartado: `TaskScheduler` com um gatilho por janela** (agendar o instante exato). Perde-se tudo
ao reiniciar e precisa ser reconstruído a partir do banco — que é o reconciliador de qualquer forma,
mais o estado em memória para dessincronizar.

**Descartado: predicado temporal (`inicio <= now() < fim`) nas leituras.** Painel, motor e efeitos
discordariam por segundos; o equipamento ficaria "em manutenção" sem que os incidentes tivessem sido
fechados.

---

## MA07 — Agendador com propriedade própria, desligado por padrão, e criação recusada quando desligado

`manutencao.agendada.enabled` condiciona o bean do reconciliador. `POST` responde 409 se desligado.

*Corrigido em 2026-10-22, na preparação da F1:* a primeira versão desta entrada dizia que o
reconciliador precisaria de `@EnableScheduling` próprio. Não precisa: `NotificationDispatcherConfiguration`
não é condicional e já habilita o agendamento sempre. A decisão (propriedade própria, desligada,
criação recusada) não muda.

**Descartado: amarrar ao `monitoring.engine.enabled`.** Os efeitos (painel, SLA, notificações de
encerramento) importam com o motor desligado também.

**Descartado: ligado por padrão.** Contraria a regra do projeto ("ligar é ato explícito") e faria o
reconciliador rodar em toda suíte de integração.

---

## MA08 — Nada é retroativo; atraso é gravado

Início perdido com fim no futuro → ativa atrasada. Janela inteira perdida → `EXPIRADA`, sem efeito.
Fim perdido → conclui no instante real. `ativada_em`/`encerrada_em` separados do previsto.

**Descartado: aplicar no passado.** Reescreveria `janela_monitoramento` histórica e, no fim, contaria
como disponível um tempo em que nada foi medido.

**Descartado: pular a janela cujo início passou.** A intervenção provavelmente está acontecendo; pular
gera alarme falso justamente quando a equipe está mexendo no equipamento.

---

## MA09 — Cancelar só AGENDADA; ATIVA tem "Encerrar agora"; nada é apagado

**Descartado: o "Cancelar" do mockup** (remove a linha, aparece em CONCLUÍDA, promete que "o período
passará a contar para o SLA"). Apagar destrói o histórico; e o período de uma janela ativa não pode
voltar ao SLA porque não foi medido.

---

## MA10 — Autor dos incidentes fechados por janela é o criador da janela

`fechado_por = criado_por_id` quando o reconciliador ativa. Mantém a semântica da V17 (nulo = motor) e
`EquipamentoService.autor`, que recusa autor nulo.

**Descartado: `fechado_por` nulo.** O relatório leria "fechado pelo motor".

---

## MA11 — Telegram da janela: sim, uma mensagem por janela, em fatia própria (F3)

Ver desenho §6.3. Depende de P-02.

**Descartado: na F1.** Exige âncora nova em `notificacao` e recriar duas constraints; dobraria o
tamanho da fatia sem ser necessário para o efeito principal (não alarmar).

---

## MA12 — Motor espera a primeira passada do reconciliador

`MonitoringScheduler` pula ticks até o reconciliador concluir a primeira passada, quando ele está
ligado. O `@Scheduled` do motor nasce no `ContextRefreshedEvent`, antes de `ApplicationRunner`.

**Descartado: confiar no limiar de falhas.** A janela de SLA sobrevive ao desligamento e as falhas de
antes dele contam para a sequência.

---

## MA13 — Tela em Gerenciamento, rota `/manutencoes`

Ver desenho §8. **Descartado: Administração**, como no mockup — no app ela é só ADMIN, e a ação é do
OPERADOR.

---

## MA14 — `unidade.ativo` fica fora deste ciclo

Ver desenho §5.1 e P-08. Duas mudanças de semântica de elegibilidade num diff só tornariam a
regressão impossível de atribuir.

---

## MA15 — Duração máxima configurável sem recompilar (P-04)

72 h por padrão em `manutencao.agendada.duracao-maxima`, lido de `MANUTENCAO_AGENDADA_DURACAO_MAXIMA`
(`java.time.Duration`: `72h`, `5d`, `90m`). Ajustar = mudar a variável do serviço e reiniciar. A tela
lê o valor em `GET /manutencoes/parametros` para validar antes de enviar; o backend valida de novo.

**Descartado: constante no código.** Mudar exigiria build e deploy por um número de operação.

**Descartado: tabela de configuração editável pela tela.** Sem tela de configurações do sistema hoje;
seria construir um subsistema para um parâmetro.

---

## MA16 — O 409 do agendador desligado diz o que fazer

Mensagem fixa: `Agendamento de manutencao desligado neste servidor: nenhuma janela seria ativada.
Para ligar, defina MANUTENCAO_AGENDADA_ENABLED=true nas variaveis de ambiente do servico do backend e
reinicie-o. Enquanto isso, use "Iniciar manutencao" no equipamento.` A tela antecipa com banner e
botão desabilitado, lendo `agendadorLigado` de `/parametros`.

---

## MA17 — A tela diz que cancelar ou encerrar não recupera SLA

Textos fixos no diálogo de cancelar (AGENDADA: nada mudou no SLA ainda), no de encerrar agora (ATIVA:
o período decorrido continua fora porque não foi medido) e numa nota fixa abaixo da tabela. Texto
exato no spec da F1 (`Docs/superpowers/specs/2026-10-22-manutencao-agendada-f1-design.md` §3.2).

**Descartado: o texto do mockup** ("o período passará a contar para o SLA"), que é falso.
