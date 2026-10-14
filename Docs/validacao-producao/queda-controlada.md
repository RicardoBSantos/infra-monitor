# Queda controlada

Último item da validação: provar o caminho completo com um equipamento real e o Telegram no grupo
real. São 3 falhas seguidas → incidente aberto → alerta, e depois 2 sucessos → incidente fechado →
alerta de recuperação. Gera alerta real no grupo: só com aval explícito e com a equipe avisada.

## Procedimento

O incidente é provocado trocando o IP de um equipamento real por `192.0.2.1` (TEST-NET-1, nunca
roteado e aceito pela `RegraIpv4`), e depois devolvendo o IP original. O motor relê os candidatos a
cada ciclo, então a troca vale no ciclo seguinte. Nada é desligado na rede.

1. **Antes:** conferir que o equipamento está no IP real e sem incidente aberto; ter a equipe
   avisada.
2. **Derrubar:** fazer `GET /api/v1/equipamentos/{id}` e guardar o corpo. O `PUT` aplica o corpo
   inteiro (campo ausente vira nulo), então ele vai completo, copiado do `GET`, trocando só o `ip`:

   ```json
   { "unidadeId": 2, "tipoEquipamentoId": 2, "nome": "Gateway Servidores", "ip": "192.0.2.1",
     "hostname": null, "descricao": "<igual ao atual>", "localizacao": null,
     "numeroSerie": null, "fabricante": null, "modelo": null }
   ```
3. **Esperar** 3 FALHAs (cerca de 90 s com intervalo de 30 s), o incidente `ABERTO` e a notificação
   `INCIDENTE_ABERTO` com status `ENVIADA`.
4. **Restaurar:** o mesmo `PUT` com o corpo guardado e o IP original.
5. **Esperar** 2 SUCESSOs, o incidente `FECHADO` com `RECUPERACAO_AUTOMATICA` e a notificação
   `INCIDENTE_FECHADO` com status `ENVIADA`.
6. **Conferir:** 2 linhas em `notificacao`, 0 episódios de latência, 0 ERROR/WARN no log e o
   equipamento de volta ao IP real.

Consulta de acompanhamento (só leitura):

```sql
select executado_em, status, latencia_ms, mensagem from medicao where monitor_id = :monitor
  and executado_em > :inicio order by 1;
select id, status, iniciado_em, encerrado_em, motivo_encerramento from incidente;
select id, incidente_id, tipo_evento, status, tentativas, enviado_em, erro from notificacao order by id;
```

## Resultado

### Rodada de 2026-10-14: Gateway Servidores (ITA, `10.70.10.1`), banco `inframonitor-carga`

Executada com aval explícito, depois das 4 h de observação.

| Horário (UTC) | Evento |
|---|---|
| 15:58:16 | PUT: IP → 192.0.2.1 (200) |
| 15:58:27 / 15:58:58 / 15:59:28 | 3 FALHAs (`Timeout`), já no ciclo seguinte à troca |
| 15:59:30 | Incidente 1 `ABERTO` ("Indisponibilidade detectada automaticamente apos 3 falhas consecutivas.") |
| 15:59:31 | Telegram `INCIDENTE_ABERTO` `ENVIADA`, tentativa 1 |
| 15:59:41 | PUT: IP → 10.70.10.1 (200) |
| 15:59:58 / 16:00:29 | 2 SUCESSOs (4 ms) |
| 16:00:29 | Incidente 1 `FECHADO`, `RECUPERACAO_AUTOMATICA` |
| 16:00:30 | Telegram `INCIDENTE_FECHADO` `ENVIADA`, tentativa 1 |

- Da troca do IP até o alerta no grupo: 75 s. Da restauração até o alerta de recuperação: 50 s.
  Incidente com 2 min 02 s.
- A regra 3/2 foi cumprida exatamente.
- Depois: `notificacao` com exatamente essas 2 linhas, 0 episódios de latência, 0 ERROR/WARN no
  log, equipamento em `10.70.10.1`.
- **Achado:** a resposta do PUT traz o `updatedAt` da gravação anterior. O de derrubar respondeu
  `11:33:33Z` (a criação) e o de restaurar respondeu `15:58:16Z`. O banco fica certo; só o corpo da
  resposta vem atrasado. Não corrigido.

### Próxima rodada (máquina de deploy)

A rodada acima foi feita da máquina de desenvolvimento (`10.79.20.163`). Repetir o procedimento a
partir da máquina dedicada ao monitoramento, depois da carga completa, e registrar aqui:

| Campo | Valor |
|---|---|
| Data | |
| Máquina de origem (IP, VLAN) | |
| Equipamento derrubado (nome, unidade, IP real) | |
| Troca do IP (UTC) | |
| 3ª FALHA / incidente aberto (UTC) | |
| `INCIDENTE_ABERTO` enviada (UTC, tentativas) | |
| Restauração (UTC) | |
| 2º SUCESSO / incidente fechado (UTC, motivo) | |
| `INCIDENTE_FECHADO` enviada (UTC, tentativas) | |
| Linhas em `notificacao` / episódios / ERROR-WARN | |
| Mensagens conferidas no grupo (sim/não, quem conferiu) | |
| Desvios | |
