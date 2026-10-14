# Endereçamento da rede do Sesc

Data: 2026-10-14. Fatos fornecidos pela equipe de rede; referência para o cadastro da carga real
([carga-real-preparacao.md](carga-real-preparacao.md)). Nada aqui foi alterado no código nem no banco.

## 1. Esquema

```
10.<unidade>.<vlan>.<host>
```

- 2º octeto = código da unidade;
- 3º octeto = número da VLAN;
- 4º octeto = host.

Exemplos reais: `10.79.10.6` → unidade 79 (Sede), VLAN 10 (Servidores), host `.6`;
`10.70.10.1` → unidade 70 (Itabaiana), VLAN 10 (Servidores), gateway `.1`.

> **A confirmar com a equipe de rede:** a descrição verbal recebida falava em "terceiro octeto =
> unidade, quarto octeto = VLAN". Os IPs reais (10.79.10.6 Sede/VLAN 10; 10.70.10.1 Itabaiana/VLAN 10,
> gateway) mostram unidade no **2º** octeto e VLAN no **3º**. Este documento segue os exemplos.

## 2. Unidades

| Código (2º octeto) | Unidade |
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

## 3. VLANs

| VLAN (3º octeto) | Uso | Máscara |
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

## 4. Observações

- **VLAN 53 (Wi-Fi Visitantes, /23) não é monitorável.** Fica atrás do pfSense e não é alcançável
  da rede interna: não cadastrar monitor ICMP para ela. Todo ping falharia e viraria incidente falso.
- **Tobias (67) ainda não foi construída.** Nenhum endereço da faixa `10.67.x` responde hoje; não
  cadastrar.
- **IPs fictícios do banco de dev colidem com unidades reais.** O banco de dev
  (`inframonitor-postgres`, porta 5434: 12 unidades, 222 equipamentos) usa a faixa `10.x`. Contagem
  por 2º octeto (só `SELECT`, 2026-10-14) que coincide com códigos da tabela acima:

  | 2º octeto | Unidade real | Equipamentos fictícios |
  |---|---|---|
  | 71 | Socorro | 19 |
  | 72 | Hotel Atalaia | 26 |
  | 73 | Comércio | 18 |
  | 74 | Riomar | 25 |
  | 75 | Cacabs | 17 |
  | 76 | Galeria | 24 |
  | 77 | Centro Integrado de Saúde | 16 |
  | 78 | Cabman | 23 |
  | 79 | Sede | 18 |
  | **Total** | | **186 de 222** |

  Os outros 36 estão em `10.80.x` (22) e `10.81.x` (14), fora da tabela. Por isso a carga real vive
  num banco separado (`inframonitor-carga`, 127.0.0.1:5436), e **o motor nunca deve ser ligado contra
  o banco de dev numa máquina dentro da rede do Sesc**: pingaria alvos reais com cadastro errado.

  Consulta usada (somente leitura):

  ```bash
  docker exec inframonitor-postgres psql -U inframonitor -d inframonitor -At -c \
    "select split_part(host(ip_address::inet),'.',2) as o2, count(*) from equipamento
     where ip_address like '10.%' group by 1 order by 1"
  ```

- **Exemplos cadastrados nesta rodada:**
  - Sede — `10.79.10.6`, Servidor AD Core, VLAN 10;
  - Itabaiana — `10.70.10.1`, gateway da VLAN 10 de Itabaiana: âncora de alcance da unidade, enlace
    WAN até a Sede.

## 5. Como usar no cadastro

- Derivar unidade e VLAN do próprio IP: 2º octeto → unidade (seção 2), 3º octeto → VLAN (seção 3).
  IP cujo 2º octeto não bate com a unidade da linha da planilha merece conferência com a equipe de
  rede antes do `--aplicar` (o script não faz essa checagem).
- Como âncora de alcance de cada unidade, preferir o gateway `.1` da VLAN de servidores
  (`10.<unidade>.10.1`), como em Itabaiana.
- Não cadastrar monitor na VLAN 53 nem na faixa `10.67.x`.
