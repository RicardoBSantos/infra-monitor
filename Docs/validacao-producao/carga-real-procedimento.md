# Procedimento de carga real (não executado)

Script: `tools/carga-real/carga.mjs`. Cadastra dados reais no Infra Monitor
**pela API REST** (nunca por SQL). Detalhes de formato de arquivo, campos e
regras de validação: `tools/carga-real/README.md`. Este documento é o
passo a passo operacional para quem for de fato rodar a carga.

Este procedimento **não foi executado** contra nenhum servidor até agora —
foi escrito e testado só com testes unitários (`node --test`, sem rede) e uma
simulação em memória com `fetch` falso. A primeira execução real deve ser
feita com cautela, começando em `--dry-run` (o padrão).

## 0. Antes de subir a versão com a migration V20

A V20 adiciona um CHECK de IPv4 de host em `equipamento.ip_address`. Se existir linha
fora da regra, o Flyway falha no boot e a aplicação não sobe. Antes de atualizar o
servidor, rode no banco de produção a pré-checagem do cabeçalho da V20 (tem de devolver **0**):

```sql
SELECT count(*) FROM equipamento WHERE ip_address IS NOT NULL AND ip_address !~ '^(22[0-3]|2[01][0-9]|1[0-9]{2}|[1-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])){3}$';
```

Se devolver mais que 0, corrija essas linhas primeiro (liste-as trocando `count(*)` por `id, nome, ip_address`).

## 1. Preparar o arquivo de entrada

Copie `tools/carga-real/modelo/` para um novo diretório (ou copie
`modelo.json`) e preencha com os dados reais, seguindo a tabela de colunas do
README. Ordem de processamento: tipo → unidade → equipamento → monitor →
conexão de hub — mas no arquivo as 5 listas podem estar em qualquer ordem,
o script cuida da sequência.

Pontos que travam a carga se errados:

- `sigla` de unidade e `nome` de tipo são as chaves usadas para casar com o
  que já existe na API — mudar a grafia entre execuções cria um registro novo
  em vez de atualizar comparação.
- IP tem que ser IPv4 de host: 4 octetos 0-255, sem zero à esquerda (010.0.0.1 é ambíguo, o Linux lê como octal), 1º octeto 1-223. IPv6 e multicast são recusados. O backend (migration V20) recusa o mesmo no banco.
- `codigoIbge` tem que ter exatamente 7 dígitos **e existir no GeoJSON de
  SE** — se não existir, é **erro** (a linha não é enviada), mesmo que a
  linha não tenha coordenada nenhuma. Só depois de o IBGE existir é que entra
  a checagem de coerência: se a coordenada informada não cai dentro do
  município daquele IBGE, o script deixa passar como **aviso** — a coordenada
  é a que prevalece — mas revise antes de aplicar.

## 2. Definir a credencial

```bash
export CARGA_API_URL="https://host/api/v1"
export CARGA_EMAIL="operador@exemplo.com"
export CARGA_SENHA="********"          # nunca em arquivo
```

Papel mínimo: **OPERADOR**. Usuário com troca de senha obrigatória pendente é
recusado pelo próprio script (o backend, hoje, não bloqueia esse login
sozinho — ver README para o porquê).

## 3. Rodar a simulação (dry-run — padrão)

```bash
node tools/carga-real/carga.mjs --entrada caminho/para/seus-dados --relatorio relatorio-simulacao.json
```

Sem `--aplicar`, nenhum `POST`/`PUT` é enviado — o script só faz `GET` para
ler o estado atual e validar. Nada é escrito na API.

## 4. Ler o relatório

O console imprime o resumo:

```
[dry-run] criados=12 pulados=3 divergentes=1 falhas=2 avisos=0
```

Abra `relatorio-simulacao.json` e cheque item a item, especialmente:

- `"acao": "falha"` — linha com erro de validação, ou referência que não
  resolveu (tipo/unidade/equipamento inexistente). Não foi enviada.
- `"acao": "pulado"` com motivo `pulado: dependência falhou` — a própria
  linha estava OK, mas depende de outra linha que falhou (ex.: equipamento
  cujo tipo tinha erro). Corrija a linha de origem e rode de novo.
- `"acao": "divergente"` — já existe na API com campos diferentes do
  arquivo (`campos` lista quais). O script **não sobrescreve**; se a mudança
  for intencional, é preciso editar pela tela/API manualmente.
- avisos (IBGE × coordenada, IP repetido entre unidades) não bloqueiam nada,
  mas vale revisar antes de aplicar.

Se algo parecer errado, ajuste o arquivo de entrada e rode a simulação de
novo — quantas vezes forem necessárias. Só se aplica de fato no passo 5.

## 5. Rodar com `--aplicar`

```bash
node tools/carga-real/carga.mjs --entrada caminho/para/seus-dados --aplicar --relatorio relatorio-aplicado.json
```

Agora o script envia `POST`/`PUT` para as linhas cuja ação era `criar`. Itens
`pulado`/`divergente`/`falha` continuam sem nenhuma escrita. Se a API
responder `401` no meio da execução (sessão expirada ou revogada), o script
aborta imediatamente e grava o relatório parcial — rode de novo depois de
renovar a credencial; o que já foi criado fica registrado como `pulado` na
próxima leitura, então não duplica.

## 6. Rodar de novo e confirmar idempotência

```bash
node tools/carga-real/carga.mjs --entrada caminho/para/seus-dados --aplicar --relatorio relatorio-confirmacao.json
```

O resumo esperado agora é `criados=0`, com tudo em `pulados` (ou
`divergentes`, se algo foi alterado na API por fora entre as duas execuções).
Rodar a carga de novo com o mesmo arquivo **nunca** deve criar duplicata —
essa é a prova de idempotência do script.

## Verificações do script (resumo — detalhes no README)

Obrigatórios por linha; par de coordenadas; IBGE 7 dígitos e existente no
GeoJSON de SE; IBGE × coordenada (aviso, não bloqueio); IPv4 válido; IP
repetido na mesma unidade (erro) e entre unidades (aviso); nome único por
unidade/equipamento no arquivo; referências resolvíveis (arquivo + API);
ciclo no grafo de hub combinando arquivo e API.

## O que o script não verifica (resumo — detalhes no README)

Se o IP responde ping; se a coordenada é a real; se o IBGE está certo quando
já é coerente com a coordenada; unicidade global de IP (só por unidade);
regras de negócio que só o backend conhece e podem mudar depois; concorrência
com outro operador cadastrando ao mesmo tempo; correção automática de dados
já existentes que divergem (só relata, não sobrescreve).

## Credencial

`CARGA_API_URL`, `CARGA_EMAIL`, `CARGA_SENHA` só por variável de ambiente,
nunca em arquivo. Papel mínimo OPERADOR. Usuário com troca de senha
obrigatória pendente falha no login (checagem feita pelo próprio script,
não pelo backend) e o script para.

## Decisão registrada: chave natural do monitor

A especificação original (seção 4 do design) previa a chave natural do
monitor como `(equipamento, tipo, alvo)`. O campo `alvo` **não existe** em
`CreateMonitorRequest`/`MonitorResponse` no backend real — só existe
`equipamentoId, tipo, nome, intervaloSegundos, timeoutMs,
falhasParaIncidente, sucessosParaRecovery` — e não há nenhuma constraint de
banco definindo unicidade de monitor (`grep uq_monitor` só encontra
`uq_monitor_episodio_latencia_aberto`, de outra tabela). A chave usada pelo
script é `(unidadeSigla, equipamentoNome, nome)` — a mesma tripla usada pelo
`task-7-brief.md`, que foi conferido contra o DTO real antes da
implementação. Isso está documentado também no `README.md` do script.
