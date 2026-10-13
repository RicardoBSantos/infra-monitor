# Validação em produção — ciclo

Documentação persistente do ciclo de validação que antecede a sondagem de equipamentos reais:
uma rodada de correções levantadas ao testar o motor de monitoramento ICMP contra a rede real desta
máquina, mais uma proposta de desenho (ainda não implementada) para o comportamento de manutenção.

Segue o padrão de `mapa-architecture/`: uma pasta por ciclo, com um arquivo-índice de mesmo nome da
pasta.

## Arquivos

| Arquivo | O que é |
|---|---|
| [icmp-falsos-positivos.md](icmp-falsos-positivos.md) | Os falsos positivos do `ping.exe` no Windows, a decisão pela API nativa `IcmpSendEcho` via JNA, a evidência medida e o teste contra a rede real |
| [manutencao-proposta.md](manutencao-proposta.md) | Proposta de desenho (sem código) para suprimir notificação e incidente durante a manutenção de um equipamento |
| [manutencao-auditoria-enums.md](manutencao-auditoria-enums.md) | Auditoria dos três enums novos de manutenção — StatusNotificacao.CANCELADA, TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO, LATENCIA_ENCERRADA_MANUTENCAO — e cada ponto de leitura/escrita no backend e frontend |
| [manutencao-backfill-diagnostico.md](manutencao-backfill-diagnostico.md) | Diagnóstico do backfill de motivo_encerramento da V19 — contagens reais por faixa de 76 incidentes fechados no banco de dev |
| [manutencao-verificacao-ponta-a-ponta.md](manutencao-verificacao-ponta-a-ponta.md) | Verificação ponta a ponta do módulo de manutenção com backend ICMP real, dispatcher de notificação, Postgres descartável e mock do Telegram |
| [capacidade-pool-monitoramento.md](capacidade-pool-monitoramento.md) | Medição do pool de monitoramento numa queda em massa: 9 células de K caídos × workers, e a proposta de `worker-threads`/`queue-capacity` que sai dos números |
| [icmp-revisao-branch-relatorio.md](icmp-revisao-branch-relatorio.md) | Relatório final da revisão do branch `fix/icmp-nativo-windows`: contradição do tipo de `equipamento.ip_address`, modo de falha da biblioteca nativa, exceções nos pools, e a seção A.1 com o `/status` verdadeiro de motor desligado |
| [topologia-git-e-estrategia-de-merge.md](topologia-git-e-estrategia-de-merge.md) | Levantamento só de leitura da topologia de branches, distância até `main`/`origin/main` e proposta de estratégia de merge por frente de trabalho |
| [riscos-execucao-correcoes.md](riscos-execucao-correcoes.md) | Os três riscos de execução fechados antes do merge: CAS no fechamento automático, `lock_timeout` no motor e pool, janela na exclusão de monitor — com distribuição de desfechos das corridas reais e prova de reversão |
| [auditoria-concorrencia-ciclo-de-vida.md](auditoria-concorrencia-ciclo-de-vida.md) | Inventário de toda escrita de ciclo de vida: guarda no banco ou ler-depois-escrever, teste concorrente real ou só sequencial, desfecho ilegítimo possível, classificado por risco — sem correções |
| [dividas-fechamento-branches.md](dividas-fechamento-branches.md) | Dívidas registradas no fechamento dos dois branches, com o achado metodológico em destaque: teste sequencial de concorrência passa sobre código quebrado |
| [correcoes-pre-carga-real.md](correcoes-pre-carga-real.md) | As correções feitas antes da carga real: limpeza e verificação da V19 no dev, reabertura após fechamento manual (âncora de observação), linha do tempo por motivo, mensagem de fechamento manual, decimal pt-BR, plural, zero neutro, aviso de IBGE, e as contagens das suítes e do build |
| [divida-latencia-sub-milissegundo.md](divida-latencia-sub-milissegundo.md) | Dívida: `medicao.latencia_ms INTEGER` grava RTT < 1 ms como 0; opções, impacto por camada, recomendação e gatilho de cobrança (sem código alterado) |
| [rodada-curta-pre-carga.md](rodada-curta-pre-carga.md) | Rodada curta antes da carga real: timeline só cita N quando lista a sequência (e episódio de latência com o motivo real de encerramento), IP só IPv4 de host nas quatro camadas (API, V20, formulário, script), e2e e suítes |
| [monitoramento-parado-investigacao.md](monitoramento-parado-investigacao.md) | Investigação (sem código) de como detectar monitoramento parado: estado atual, opções com custo e cobertura (inclui hibernação e reinício), recomendação |
| [env-testes-docker-environment-prod.md](env-testes-docker-environment-prod.md) | `.env` desarmado (token nunca commitado; variáveis injetadas pelo serviço, Telegram desligado por padrão e travado em teste), 27 classes Postgres puladas com aviso sem Docker, `environment.prod.ts` com `apiUrl` relativa e as opções para servir o frontend |
| [evidencias/](evidencias/) | Capturas brutas (log de subida, respostas de `/api/v1/status`) que sustentam as seções resumidas dos relatórios acima |
| [design — icmp-nativo-windows](../superpowers/specs/2026-09-21-icmp-nativo-windows-design.md) | O design que este ciclo implementou: contrato `IcmpResult`/`StatusIcmp`, mapeamento de códigos Win32, componentes criados |

## Dívidas do ciclo

1. Nada detecta um período em que o monitoramento parou: se o processo cai, a ausência de medições
   é indistinguível de um monitor sem candidatos. **Investigada em 2026-10-09**, sem código:
   [monitoramento-parado-investigacao.md](monitoramento-parado-investigacao.md).
2. O formato de saída do `ping` do Linux não foi verificado em máquina Linux — a fixture do
   `iputils` existe nos testes marcada como formato de referência, não como formato confirmado.
3. A execução como conta de sistema (SYSTEM) não foi verificada: `schtasks /ru SYSTEM` devolveu
   `ERRO: Acesso negado.` nesta máquina, que não é administradora. Ver
   [icmp-falsos-positivos.md](icmp-falsos-positivos.md) para o comando e o raciocínio separado da
   verificação.
4. `WindowsNativeIcmpRunner.paraOrdemDeRede` só entende IPv4, mas `equipamento.ip_address` é
   `VARCHAR(45)` (a `V4__make_equipamento_ip_optional.sql` converteu a coluna a partir de `INET`,
   derrubando o tipo e a constraint de host — ver `icmp-revisao-branch-relatorio.md`, seção 1) e não
   valida nada; aceita IPv6, hostname ou lixo. Um alvo IPv6 falharia em toda sondagem.
   **Resolvida em 2026-10-09:** só IPv4 de host entra, com CHECK no banco (`V20`); ver
   [rodada-curta-pre-carga.md](rodada-curta-pre-carga.md#item-2--ip-só-ipv4-de-host-entra).
