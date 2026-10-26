# Manutenção agendada — arquitetura e ciclo

Documentação persistente do ciclo de **janelas de manutenção agendadas**: intervenções planejadas com
início, fim, motivo, autor e escopo (equipamentos ou unidade inteira), que convivem com o botão de
manutenção manual entregue no PR #17.

Segue o padrão de `mapa-architecture/`: uma pasta por ciclo grande, com um arquivo-índice de mesmo
nome da pasta.

**Estado em 2026-10-22: F1 implementada** no branch `feat/manutencao-agendada`
(spec: `Docs/superpowers/specs/2026-10-22-manutencao-agendada-f1-design.md`). O SQL do desenho virou a
`V21__create_manutencao_agendada.sql`. P-01, P-04, P-06 e P-09 decididas; P-02 adiada para a F3.
Evidências (suítes, corridas e reversões, e2e por clique, exercício no banco da carga):
[`Docs/validacao-producao/manutencao-agendada-f1.md`](../validacao-producao/manutencao-agendada-f1.md).

**Estado em 2026-10-26: F3 implementada** no branch `feat/manutencao-f3` (spec:
`Docs/superpowers/specs/2026-10-26-manutencao-agendada-f3-design.md`). Telegram para a janela (início, fim, alteração do
fim) e para o botão manual (ligar, desligar), com sessão manual histórica (`manutencao_manual`), âncoras novas em
`notificacao` e mensagens em horário local (`V23__add_notificacao_manutencao_e_manutencao_manual.sql`). Decisões
MA27–MA36; P-02 fechada. **A V23 ainda não está no banco da carga** (a 8080 roda código da V22 com Telegram real).
Evidências: [`Docs/validacao-producao/manutencao-agendada-f3.md`](../validacao-producao/manutencao-agendada-f3.md);
auditoria dos call sites: [`manutencao-f3-auditoria-enums.md`](../validacao-producao/manutencao-f3-auditoria-enums.md).

## Arquivos

| Arquivo | O que é |
|---|---|
| [manutencao-agendada-desenho.md](manutencao-agendada-desenho.md) | Investigação e desenho completo: mockup campo a campo, modelo, ciclo de vida, convivência com o botão, escopo unidade, efeitos, concorrência, tela, fatiamento |
| [manutencao-agendada-decisoes.md](manutencao-agendada-decisoes.md) | Log de decisões (MA01–MA36): o que foi decidido, o que foi descartado, por quê |
| [manutencao-agendada-pendencias.md](manutencao-agendada-pendencias.md) | Decisões de produto em aberto e dívidas que o desenho não resolve de propósito |

## Regra de manutenção

Mesma do Mapa: **toda decisão nova deste ciclo atualiza `manutencao-agendada-decisoes.md` dentro do
commit da própria mudança.** Decisão que reverte outra não apaga a entrada antiga; acrescenta uma nova.
Antes de batizar uma decisão, conferir os `## MA` do `origin/main` (número colide entre branches).

## Resumo em cinco linhas

1. `equipamento.em_manutencao` continua sendo **a** guarda de todo o sistema (motor, INSERTs
   condicionais, janela de SLA, painel) e passa a significar *manutenção efetiva*.
2. Coluna nova `manutencao_manual` guarda o botão. Efetiva = `manual OR coberto por janela ATIVA`,
   com `CHECK (NOT manutencao_manual OR em_manutencao)` no banco.
3. Tabela nova `manutencao_agendada` (+ ligação com equipamentos). Não reutiliza
   `janela_monitoramento`, que é elegibilidade de SLA e é *efeito* da manutenção, não a manutenção.
4. Um reconciliador de nível (tick de 30 s e na subida) move AGENDADA → ATIVA → CONCLUÍDA e corrige
   qualquer equipamento cujo `em_manutencao` divirja do desejado. Nunca aplica nada retroativamente.
5. Primeira fatia útil: backend + tela de lista/agendamento, sem Telegram e sem edição.
