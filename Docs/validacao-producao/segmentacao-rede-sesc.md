# Segmentação da rede do Sesc

Data: 2026-10-14. Fatos da equipe de rede, conferidos contra os IPs reais usados na validação.
Complementa [rede-sesc-enderecamento.md](rede-sesc-enderecamento.md), que traz a contagem da colisão
com o banco de dev e as regras de cadastro.

## Esquema

```
10.<unidade>.<vlan>.<host>
```

> **Posição dos octetos.** A descrição verbal recebida fala em "terceiro octeto = unidade, quarto
> octeto = VLAN". Os IPs reais desmentem isso: `10.79.10.6` é a sede (79) na VLAN 10,
> `10.70.10.1` é Itabaiana (70) na VLAN 10, e a máquina desta validação, `10.79.20.163`, é a sede na
> VLAN 20. Na prática, **2º octeto = unidade, 3º octeto = VLAN, 4º octeto = host**. As tabelas
> abaixo seguem os IPs reais. Falta a equipe de rede confirmar.

## Unidades (2º octeto)

| Código | Unidade |
|---|---|
| 79 | Sede |
| 78 | Cabman |
| 77 | Centro Integrado de Saúde |
| 76 | Galeria |
| 75 | Cacabs |
| 74 | Riomar |
| 73 | Comércio |
| 72 | Hotel Atalaia |
| 71 | Socorro |
| 70 | Itabaiana |
| 69 | Escola Sesc |
| 68 | Indiaroba |
| 67 | Tobias (ainda não construída) |

## VLANs (3º octeto)

| VLAN | Uso | Máscara |
|---|---|---|
| 1 | MGMT | /24 |
| 5 | TI | /24 |
| 10 | Servidores | /24 |
| 15 | MGMT Biometria | /24 |
| 20 | Desktop ADM | /24 |
| 30 | Desktop Lab | /24 |
| 40 | Impressoras | /24 |
| 50 | MGMT Wi-Fi | /24 |
| 51 | Wi-Fi ADM | /24 |
| 52 | Wi-Fi Devices | /24 |
| 53 | Wi-Fi Visitantes | **/23** |
| 60 | Telefonia | /24 |
| 70 | CFTV | /24 |

Máscara /24 em todas, exceto a VLAN 53, que é /23.

## Ressalvas

- **VLAN 5** é exclusiva dos computadores da TI na sede. Não existe como segmento de equipamento nas
  outras unidades.
- **VLAN 53** (Wi-Fi Visitantes) fica atrás do pfSense e não é alcançável da rede interna. Não
  cadastrar monitor nela: todo ping falharia e viraria incidente falso.
- **Tobias (67)** ainda não foi construída e não tem equipamento. Nada na faixa `10.67.x` responde;
  não cadastrar.

## ⚠ IPs do banco de dev caem em unidades reais

O banco de dev (`inframonitor-postgres`, porta 5434) tem equipamentos fictícios com IPs em faixas
que **são unidades reais**: `10.73.x` é Comércio, `10.75.x` é Cacabs, `10.72.x` é Hotel Atalaia, e
o mesmo vale para 71, 74, 76, 77, 78 e 79. São 186 dos 222 equipamentos do dev (contagem em
[rede-sesc-enderecamento.md](rede-sesc-enderecamento.md#4-observações)).

**O motor nunca deve ser ligado contra o banco de dev numa máquina dentro da rede do Sesc.** Ele
pingaria hosts reais com cadastro inventado: alarmes sobre equipamentos que não são o que o cadastro
diz, e tráfego ICMP para endereços que ninguém pediu para monitorar. A carga real vive em banco
separado (`inframonitor-carga`, 127.0.0.1:5436).

## Origem do monitoramento

- A validação de 2026-10-14 foi feita a partir de **`10.79.20.163`**: sede, VLAN 20 (Desktop ADM),
  máquina de desenvolvimento. Dela, `10.79.10.6` (sede, VLAN 10) e `10.70.10.1` (Itabaiana, VLAN 10)
  responderam ping por 4 h ([validacao-4h-equipamentos-reais.md](validacao-4h-equipamentos-reais.md)).
- **O deploy será em outra máquina**, dedicada ao monitoramento. Alcance ICMP depende de VLAN de
  origem, ACL e firewall, então o que respondeu daqui não prova nada sobre lá. **Antes da carga,
  reconfirmar no local, a partir da máquina de deploy**, o ping a pelo menos um IP de cada unidade e
  de cada VLAN que será monitorada.
