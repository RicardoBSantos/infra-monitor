# Carga real (`tools/carga-real`)

Script idempotente que cadastra dados reais no Infra Monitor **pela API REST**
(nunca por SQL direto). Sem dependências externas — Node ≥ 18, `fetch` nativo.

```
node tools/carga-real/carga.mjs --entrada <arquivo.json|diretorio> [--aplicar] [--relatorio saida.json] [--geojson caminho]
```

- **Padrão é simulação (`dry-run`)**: o script lê a API (GET) e valida, mas não
  escreve nada. Sem `--aplicar`, nenhum `POST`/`PUT` é enviado.
- `--relatorio saida.json` grava o relatório completo em arquivo (além do
  resumo impresso no console).
- `--geojson caminho` troca o GeoJSON usado na checagem IBGE × coordenada.
  Padrão: `infra-monitor-frontend/public/assets/maps/se-municipalities.geo.json`
  (o mesmo arquivo que o mapa do frontend usa).

## Credencial

Só por variável de ambiente — nunca em arquivo:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `CARGA_API_URL` | sim | Base da API, ex. `https://host/api/v1` (sem barra final) |
| `CARGA_EMAIL` | sim | Email do usuário usado para logar |
| `CARGA_SENHA` | sim | Senha do usuário |

Faltando qualquer uma, o script imprime um erro claro e sai com código `2`
**antes de tocar na rede**.

Papel mínimo exigido: **OPERADOR** (confirmado em
`infra-monitor-backend/.../security/SecurityConfiguration.java`: os métodos
`POST`/`PUT`/`PATCH`/`DELETE` de `/unidades/**`, `/tipos-equipamento/**`,
`/equipamentos/**` e `/monitores/**` exigem `ADMIN` ou `OPERADOR`; isso cobre
`PUT /unidades/{id}/conexao`, que cai na regra de `PUT /api/v1/unidades/**`).
`VISUALIZADOR` é recusado pelo próprio script antes de qualquer escrita.

Usuário com **troca de senha obrigatória pendente**: o backend hoje **não
bloqueia esse login** (`AuthService.login` não olha para
`trocaSenhaObrigatoria`). O script faz essa checagem sozinho e recusa
prosseguir, para não operar com uma credencial que a tela de login trataria
como inválida.

## Entrada

Um JSON único **ou** um diretório com 5 arquivos CSV. Ordem de processamento,
sempre: **tipo → unidade → equipamento → monitor → conexão de hub**.

Modelo pronto para copiar em [`modelo/`](./modelo): `modelo.json` (equivalente
único) e `tipos.csv unidades.csv equipamentos.csv monitores.csv conexoes.csv`.

### `tipos` (tipo de equipamento)

| Coluna | Obrigatória | Formato | Exemplo |
|---|---|---|---|
| `nome` | sim | texto, chave natural (case-insensitive) | `Roteador` |
| `descricao` | não | texto | `Equipamento de roteamento` |

### `unidades`

| Coluna | Obrigatória | Formato | Exemplo |
|---|---|---|---|
| `nome` | sim | texto | `Unidade de Exemplo` |
| `sigla` | sim | texto, até 30 caracteres, chave natural (case-insensitive) | `EX-01` |
| `descricao` | não | texto | — |
| `codigoIbge` | não | exatamente 7 dígitos, verificado contra o GeoJSON de SE | `2800308` |
| `endereco` | não | texto | `Rua Exemplo 100` |
| `cidade` | não | texto livre (não é validado contra o IBGE) | `Aracaju` |
| `uf` | não | sigla de UF brasileira | `SE` |
| `latitude` | não* | número, -90..90 | `-10.9472` |
| `longitude` | não* | número, -180..180 | `-37.0731` |

\* `latitude`/`longitude` são opcionais, mas **sempre em par**: informar só
uma das duas é erro.

### `equipamentos`

| Coluna | Obrigatória | Formato | Exemplo |
|---|---|---|---|
| `unidadeSigla` | sim | sigla de uma unidade (do arquivo ou já na API) | `EX-01` |
| `tipoNome` | sim | nome de um tipo (do arquivo ou já na API) | `Roteador` |
| `nome` | sim | texto; único por unidade (case-insensitive) | `Router-Exemplo-01` |
| `ip` | não | IPv4 de host: 4 octetos 0-255 sem zero a esquerda, 1º octeto 1-223; IPv6 recusado ("apenas IPv4 e suportado") | `192.0.2.10` |
| `hostname` | não | texto | `router-exemplo-01` |
| `descricao` | não | texto | — |
| `localizacao` | não | texto | `Rack 1` |
| `numeroSerie` | não | texto | — |
| `fabricante` | não | texto | — |
| `modelo` | não | texto | — |

### `monitores`

| Coluna | Obrigatória | Formato | Exemplo |
|---|---|---|---|
| `unidadeSigla` | sim | junto com `equipamentoNome` identifica o equipamento | `EX-01` |
| `equipamentoNome` | sim | nome do equipamento (dentro da unidade acima) | `Router-Exemplo-01` |
| `tipo` | sim | só `ICMP` (único monitor implementado hoje) | `ICMP` |
| `nome` | sim | texto; único por equipamento (case-insensitive) | `ping-principal` |
| `intervaloSegundos` | sim | inteiro, 10..86400 | `60` |
| `timeoutMs` | sim | inteiro, 100..60000 | `2000` |
| `falhasParaIncidente` | não | inteiro, 1..100 | `3` |
| `sucessosParaRecovery` | não | inteiro, 1..100 | `2` |

Chave natural do monitor: `(unidadeSigla, equipamentoNome, nome)`. (A
especificação original previa `(equipamento, tipo, alvo)`, mas
`CreateMonitorRequest`/`MonitorResponse` não têm campo `alvo`, e não existe
constraint de unicidade de monitor no banco — seguimos a chave do
`task-7-brief.md`, conferida contra o DTO real.)

`falhasParaIncidente`/`sucessosParaRecovery` omitidos no arquivo **não**
entram na comparação de idempotência: o backend aplica um default (`3`/`2`)
na criação, e comparar "omitido" contra "default" sempre daria falso
divergente. Se quiser controlar esses dois campos, informe-os explicitamente.

### `conexoes` (hub de unidade)

| Coluna | Obrigatória | Formato | Exemplo |
|---|---|---|---|
| `unidadeSigla` | sim | sigla da unidade que vai apontar para um hub | `FIL-01` |
| `conectaSigla` | sim | sigla da unidade hub | `EX-01` |

O `modelo/conexoes.csv` não tem linha de exemplo preenchida: uma conexão
sempre envolve duas unidades, e o modelo tem só uma (`EX-01`). Para testar,
duplique a linha de `unidades.csv` com outra sigla e aponte `conectaSigla`
para ela.

## O que o script verifica antes de enviar

- Campos obrigatórios de cada tipo de linha.
- Coordenadas sempre em par (as duas ou nenhuma).
- `codigoIbge` com exatamente 7 dígitos **e existente** no GeoJSON de SE —
  as duas coisas são **erro** (linha não é enviada) se faltarem, **mesmo sem
  coordenada informada**: um código com formato válido mas que não está no
  GeoJSON de SE é tratado como unidade fora do estado, algo que este script
  não aceita.
- Só quando o `codigoIbge` **existe** no GeoJSON e a linha também tem
  coordenada: point-in-polygon (com buracos, `Polygon` e `MultiPolygon`)
  contra o mesmo GeoJSON do mapa do frontend, comparando a coordenada com o
  polígono do município daquele IBGE. Aqui, sim, a divergência é **aviso**,
  não bloqueio — pela decisão já tomada no projeto, a coordenada prevalece
  sobre o código IBGE quando os dois discordam sobre qual é o município.
- IP: IPv4 válido (IPv6 é recusado). IP repetido **na mesma unidade**, dentro
  do arquivo, é **erro**; repetido **entre unidades diferentes** é **aviso**.
- Nome de equipamento único por unidade (case-insensitive) e nome de monitor
  único por equipamento (case-insensitive), dentro do arquivo.
- Referências (tipo, unidade, equipamento) resolvíveis — no arquivo ou já
  existentes na API.
- Ciclo no grafo de conexão de hub, combinando as conexões do arquivo com o
  estado atual da API (a mesma regra do backend: uma aresta só pode ser
  criada se o destino não conseguir, andando pela cadeia de hubs, voltar à
  origem; auto-referência também conta).
- Linha com erro **não é enviada**; os dependentes dela (fases seguintes que
  referenciam a linha com erro) aparecem no relatório como
  `pulado: dependência falhou`, sem tentar validar o resto.

## O que o script **não** valida

- Se o IP responde ping, ou se a coordenada é a real — dados de campo, o
  script só confere formato e consistência interna.
- Se o `codigoIbge` está certo quando já é coerente com a coordenada (nesse
  caso não há como o script saber qual dos dois é o "errado").
- Unicidade global de IP — o banco só exige unicidade por unidade
  (`uq_equipamento_unidade_ip`); o mesmo IP em unidades diferentes é só aviso.
- Regras de negócio que só o backend conhece e que podem mudar depois de este
  script ter sido escrito (a validação aqui é uma cópia deliberada das regras
  atuais, não um proxy transparente delas).
- Concorrência: se outro operador está cadastrando ao mesmo tempo, uma
  corrida pode fazer o `--aplicar` falhar com 409/400 numa linha que parecia
  livre no dry-run. O relatório mostra a linha como `falha` nesse caso; rodar
  de novo resolve, porque o script relê o estado antes de decidir.
- Dados já existentes na API **não são corrigidos**. Se o arquivo e a API
  divergem num campo, a linha some como `divergente` (com a lista de campos)
  e nada é sobrescrito — o `PUT` de unidade/equipamento/monitor no backend
  substitui o registro inteiro, então uma correção automática arriscaria
  apagar campos que o operador preencheu manualmente depois.

## Relatório

```json
{
  "iniciadoEm": "2026-09-24T12:00:00.000Z",
  "modo": "dry-run",
  "api": "https://host/api/v1",
  "resumo": { "criados": 1, "pulados": 3, "divergentes": 0, "falhas": 0, "avisos": 0 },
  "itens": [
    { "fase": "tipo", "chave": "roteador", "acao": "pulado", "motivo": "ja existe na API e e igual ao arquivo" },
    { "fase": "equipamento", "chave": "ex-01::router-exemplo-01", "acao": "criar", "motivo": "dry-run: seria criado" }
  ]
}
```

`acao` é um de: `criado` (aplicado com sucesso), `criar` (dry-run: seria
criado), `pulado` (já existe e é igual — ou dependência de fase anterior
falhou), `divergente` (já existe e é diferente; `campos` lista quais) e
`falha` (erro de validação, ou a API recusou com HTTP 4xx — o corpo
`ErroResposta` vem em `http.corpo`).

`401` no meio de uma execução com `--aplicar` (sessão expirada/revogada)
aborta imediatamente e grava o relatório parcial (`abortadoEm`) — o script
não tenta adivinhar se o restante teria funcionado.

## Testes

```bash
cd tools/carga-real
node --test test/*.test.mjs
```

`node --test test` (o diretório sem glob) apresentou um comportamento
inconsistente nesta instalação de Node (v22.14, Windows) — falha ao resolver
o diretório como módulo. Use o glob acima, ou simplesmente `node --test`
rodando dentro de `tools/carga-real/` (descoberta automática).

Todos os testes são unitários e não tocam rede: a camada `lib/api.mjs`
recebe o `fetch` como parâmetro, e os testes passam uma implementação falsa.
