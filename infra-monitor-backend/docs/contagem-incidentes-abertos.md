# Contagem de incidentes abertos

## Regra de elegibilidade

Um incidente `ABERTO` ou `RECONHECIDO` so conta como leitura operacional (contadores do
dashboard e status `INDISPONIVEL` do monitor) quando **o monitor esta ativo, o equipamento
esta ativo e o equipamento nao esta em manutencao**. Caso contrario o incidente e orfao:
continua no registro e na lista de incidentes, mas nao entra na leitura atual.

Implementacao: CTE `ESTADOS` em `DashboardReadRepository` (coluna `incidente_aberto`) e
`DashboardService.operacional` (contador por equipamento).

## Classificacao dos pontos de contagem

| # | Ponto | Decisao |
|---|---|---|
| 1 | Contador por unidade (`/dashboard/unidades`: Painel, Mapa, lista de Unidades) | Ignora inelegiveis (corrigido) |
| 2 | Detalhe da unidade (`/dashboard/unidades/{id}`) | Ignora (mesma consulta) |
| 3 | KPI "Incidentes abertos" do resumo, banner e badge da sidebar | Ignora (sai do mesmo CTE) |
| 4 | `incidentesAbertos` por equipamento (`/dashboard/unidades/{id}/equipamentos`) | Ignora (0 se inativo/manutencao) |
| 5 | Banner do Painel (lista descritiva e "+N") | Parcial: so o "+N" deriva do KPI elegivel (piso 0); a lista descritiva vem crua de `GET /incidentes` (ABERTO e RECONHECIDO) e pode citar orfao |
| 6 | Lista `/incidentes` (`DashboardIncidenteReadRepository.listar`) | Mantem: registro e unico lugar de fechar orfao |
| 7 | Abas da lista `/incidentes` | Mantem (casa com a lista) |
| 8 | `GET /incidentes` (historicos da unidade e drawer) | Mantem |
| 9 | KPI de Relatorios e PDF (`VisaoGeralPdfRepository.coletarKpis`) | Mantem bruto: e "abertos no periodo", nao leitura atual. Pode diferir do Painel |
| 10 | Disponibilidade (`DisponibilidadeSqlRepository`) | Mantem: janelas de monitoramento ja excluem desativacao/manutencao |
| 11 | Exportacao CSV de incidentes | Mantem (historico) |
| 12 | Motor, `abertosDoEquipamento`, guarda de duplicidade | Mantem (controle, nao exibicao) |
| 13 | Notificacoes/Telegram | Nada a mudar |

## Divergencia intencional

O KPI de periodo de Relatorios/PDF (ponto 9) conta incidentes abertos no periodo, sem filtro de
elegibilidade; por isso pode diferir do KPI do Painel, que e a leitura atual.

## Pendencias de dominio

- (a) Desativar monitor/equipamento nao fecha o incidente aberto (manutencao fecha).
- (b) `POST /incidentes` manual nao valida elegibilidade.
- (c) Unidade inativa continua monitorada e abrindo incidente: o KPI do resumo cobre todas as
  unidades, a soma das linhas so as ativas.
- (d) Lista descritiva do banner pode citar orfao; filtro exige elegibilidade no `GET /incidentes`.
