# Build do iperf3 para Windows — plano do job de CI

**Estado: plano em texto. Nenhum workflow foi criado.** Implementa D9. Legenda em
[banda-architecture.md](banda-architecture.md).

## Versão: tag e commit

Releases do `esnet/iperf`, consultados na API do GitHub em 2026-11-23 **[P]**:

| Tag | Publicada | Commit (`git/refs/tags`, objeto anotado desreferenciado) |
|---|---|---|
| **3.22.1** | 2026-11-20 | `acc0ed500fb2c421999948a72bb6a9e05af528d8` |
| **3.22** | 2026-09-29 | `926bd905501b792bd082d2200d1d1a84aa543e3a` |
| 3.21 | 2026-04-09 | `d39cf41526626b4e5a130f115d931cd6cbdffc19` |
| 3.20 | 2025-11-14 | `0711330bacfaf1c2a804be66e7ecc26f481ede5d` |
| 3.19.1 | 2025-07-25 | — |

**Decisão (D9, detalhada em 2026-11-23): 3.22.1, tag `3.22.1`, commit
`acc0ed500fb2c421999948a72bb6a9e05af528d8`** **[P]**.

**Antes de ir para produção, reconferir se há versão mais nova:**
- consultar `gh api repos/esnet/iperf/releases`;
- ler a seção "Security notes" de cada release posterior;
- se houver correção de segurança, subir a tag e o commit, recompilar e registrar o novo SHA-256.

**Por que pelo menos a 3.22 [P]:**
- A 3.22 corrige um **use-after-free remoto em `iperf_server_api.c`**, no código do **servidor**,
  que é exatamente o papel da unidade (`RELNOTES.md`, "Security notes" da 3.22).
- Corrige também um DoS por laço infinito (CVE-2026-102253) e um problema no tratamento dos
  parâmetros de teste (CVE-2026-71217).
- **Compilar sem OpenSSL não elimina nenhum desses três.** Eles estão no código do servidor e no
  tratamento dos parâmetros, que rodam **antes** de qualquer autenticação. "Antes" é dedução **[I]**:
  nesta build a autenticação RSA nem é compilada.
- Sem OpenSSL, só sai o código de `iperf_auth.c`, onde estava o heap overflow corrigido na 3.22.
- **A barreira real é o firewall restrito à D05, o bind em IP específico (`-B`) e a conta de baixo
  privilégio** (D9).
- **Errata da 3.22.1:** os identificadores CVE-2026-101283 e CVE-2026-101276 foram trocados nas
  mensagens dos commits `d58ad3d` e `d08588a`. Ao citar um CVE, usar as notas de release, não a
  mensagem do commit.
- A 3.22.1, frente à 3.22, só muda o build com OpenSSL 1, a errata e o CI do upstream. Sem OpenSSL, o
  binário é funcionalmente igual.

**Como fixar:**
- O job recebe `IPERF_TAG` e `IPERF_COMMIT` como constantes no workflow, nunca como entrada livre.
- Ele faz checkout da tag e falha se `git rev-parse HEAD^{commit}` for diferente de `IPERF_COMMIT`.
- Isso protege contra tag movida no upstream **[I]**.

## Ambiente: Cygwin

Escolha: **Cygwin**, no runner `windows-2022`. Compilou sem patch na run 45191296655 **[P]**.

**Por quê:**
- **O iperf3 é código POSIX.** Windows não é plataforma suportada (`README.md:29-32`) **[P]**.
  Mesmo sem OpenSSL, `iperf_getpass` usa `termios`, `tcgetattr` (`iperf_auth.c`, fora do
  `#if HAVE_SSL`) **[P]**. A biblioteca também usa pthreads e sockets BSD **[I]**.
- O `configure.ac` já reconhece Cygwin (`*-*-cygwin` em `configure.ac:185`) **[P]**. Esse é o caminho
  que o upstream ao menos considera.

**Descartados:**
- **MinGW-w64 (nativo):** sem `termios` nem a camada POSIX, exigiria patches no fonte. Isso
  contraria "compilar o fonte oficial" **[I]**.
- **MSYS2 (ambiente MSYS):** o runtime `msys-2.0.dll` é um fork do Cygwin feito para as ferramentas
  internas do MSYS2, não para distribuir aplicações. Não ganha nada sobre o Cygwin original e tem
  menos garantia de compatibilidade fora do MSYS2 **[I]**.

## Passos do job

1. Instalar o Cygwin com a action oficial `cygwin/cygwin-install-action`, **fixada por SHA de
   commit** e não por tag. Pacotes: `gcc-core`, `make`. `autoconf`, `automake` e `libtool` só
   entram se o `configure` versionado não servir. O repositório traz `configure` e `Makefile.in`
   prontos **[P]**.
2. Registrar `cygcheck -c cygwin gcc-core` no log e no manifesto: a versão do runtime vai junto com o
   binário.
3. Fazer checkout de `esnet/iperf` em `IPERF_TAG` e conferir `IPERF_COMMIT`.
4. Configurar:
   ```
   ./configure --without-openssl --disable-shared --enable-static --prefix=/opt/iperf3
   ```
   - `--without-openssl` faz o `configure.ac:171-172` emitir o aviso "Building without OpenSSL;
     disabling iperf_auth functionality" **[P]**. **O job falha se o aviso não aparecer no log.**
   - `--disable-shared` liga a `libiperf` de forma estática ao `iperf3.exe`, para não carregar
     `cygiperf-0.dll` **[I]**.
5. `make` e `make install`.
6. Verificar:
   - `iperf3.exe --version` contém a versão da tag e **não** menciona OpenSSL/authentication;
   - `iperf3.exe --help` contém `--json-stream` e `--server-max-duration`;
   - `cygcheck ./iperf3.exe` lista as DLLs. **O job falha se aparecer qualquer DLL fora da lista
     permitida.**
7. Empacotar ([abaixo](#conteúdo-do-pacote)).
8. Gerar `SHA256SUMS` com `sha256sum` de cada arquivo e o hash do zip.

## DLLs de runtime

- **Confirmado [P, run 45191296655]:** fora de `C:\Windows`, só `cygwin1.dll` (as outras são `KERNEL32`, `ntdll` e `KERNELBASE`, do sistema). A lista permitida (`ALLOWED_DLLS`) contém só ela.
- Se o `gcc` do Cygwin puxar `cyggcc_s-seh-1.dll`, ela entra na lista permitida **com justificativa
  registrada**.
- A lista definitiva sai da execução do passo 6, e não desta previsão.
- **Cuidado operacional [I]:** duas cópias diferentes de `cygwin1.dll` carregadas no mesmo sistema
  conflitam. O pacote fica numa pasta própria e **não** entra no `PATH` do sistema. O backend da D05
  chama o binário por caminho absoluto (D13).

## Licenças distribuídas junto

| Componente | Licença | Arquivo no pacote |
|---|---|---|
| iperf3 | BSD de 3 cláusulas, com cláusula de "Enhancements" da LBNL (`LICENSE`) **[P]** | `LICENSE-iperf3.txt` (cópia do `LICENSE` da tag) |
| cJSON (embutido em `src/cjson.{c,h}`) | MIT, com o texto dentro do próprio `LICENSE` do iperf3 (linhas 43 em diante) **[P]** | coberto pelo arquivo acima |
| Runtime Cygwin (`cygwin1.dll` 3.6.12-1) | LGPLv3+ com "Linking Exception", segundo o `CYGWIN_LICENSE` instalado **[P, run 45191296655]** | `COPYING-cygwin.txt`: `COPYING` (GPLv3) + `CYGWIN_LICENSE`, ambos instalados pelo pacote `cygwin`. `COPYING.LIB-cygwin.txt`: texto da LGPLv3. `CYGWIN-SOURCE.txt`: oferta de fonte |
| `cyggcc_s-seh-1.dll` | não aparece: o `cygcheck` lista só `cygwin1.dll` **[P]** | — |

**O `COPYING.LIB` não é instalado pelo pacote `cygwin`.** O `CYGWIN_LICENSE` remete a ele para o
texto da LGPLv3 **[P, run 45191296655]**. Por isso o arquivo é versionado no repositório.

**Origem escolhida: (b) versionar no repositório.** O arquivo fica em
`third-party/cygwin-3.6.12/COPYING.LIB`, com SHA-256
`da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768`.

Conferência feita em 2026-11-23 **[P]**:
- o arquivo é idêntico ao do cgit oficial
  (`cygwin.com/cgit/newlib-cygwin/plain/winsup/COPYING.LIB?h=cygwin-3.6.12`);
- é idêntico ao do espelho `github.com/cygwin/cygwin`, tag `cygwin-3.6.12`, commit `ed54dcfd…`;
- o `CYGWIN_LICENSE` dessa tag é igual ao instalado.

Por que versionar em vez de baixar no job (opção a):
- **O build não depende do `cygwin.com` estar no ar** para um arquivo que não muda dentro de uma
  versão.
- **O texto entra no diff do PR e é revisado uma vez.** Baixado a cada execução, só o hash seria
  revisado.
- A origem fica registrada em `third-party/cygwin-3.6.12/README.md`, com as duas fontes.
- Neste ambiente, o `cygwin.com` só respondeu desligando a verificação de revogação do certificado
  (`CRYPT_E_REVOCATION_OFFLINE`) **[P-lab]**. Um job que dependesse disso herdaria a fragilidade.

**O job falha se:**
- o SHA-256 do arquivo não conferir com `CYGWIN_COPYING_LIB_SHA256`;
- o runtime instalado (`cygcheck -c -d cygwin`) for diferente de `CYGWIN_RUNTIME_VERSION`
  (`3.6.12-1`);
- o arquivo não estiver no diretório dessa versão.

**Consequência:** a `cygwin-install-action` instala a versão **corrente** do espelho, não uma versão
fixa. Quando sair um Cygwin novo, o job passa a falhar até alguém trocar `third-party/` e as
constantes. A falha é proposital: impede publicar uma DLL sem a licença e sem a oferta de fonte da
mesma versão **[I]**.

**Oferta de fonte (LGPL).** O `CYGWIN-SOURCE.txt` aponta para o pacote de fonte da versão exata
**[P, `setup.ini` do espelho em 2026-11-23]**:
- pacote: `https://mirrors.kernel.org/sourceware/cygwin/src/release/cygwin/cygwin-3.6.12-1-src.tar.xz`;
- tamanho e SHA-512 do `setup.ini`: 9.318.356 bytes, `9d70312a…27889`. URL conferida com HTTP 200 e
  o mesmo tamanho;
- tag `cygwin-3.6.12` do `newlib-cygwin`.

## Conteúdo do pacote

```
iperf3-<tag>-cygwin-x64-<número da execução>.zip
├── iperf3.exe
├── cygwin1.dll
├── LICENSE-iperf3.txt
├── COPYING-cygwin.txt       COPYING (GPLv3) + CYGWIN_LICENSE do pacote cygwin instalado
├── COPYING.LIB-cygwin.txt   LGPLv3 (third-party/cygwin-3.6.12/COPYING.LIB)
├── CYGWIN-SOURCE.txt        oferta de fonte da versão exata
├── BUILD-MANIFEST.txt       tag, commit, runner, Cygwin e gcc, flags, COPYING.LIB, verificação funcional
└── SHA256SUMS               de cada arquivo acima
```

## SHA-256 e onde o artefato fica

- O hash do zip e do `iperf3.exe` aparece em quatro lugares:
  - no log do job;
  - no `SHA256SUMS`;
  - no corpo da release;
  - na [tabela de builds](#builds) abaixo.
- O pacote fica como asset de uma **GitHub Release do nosso repositório** (D-B3), com
  `--latest=false`.
  - Artefato de workflow expira (90 dias) **[E]**, e baixar o zip exige token mesmo em repositório
    público **[E, memória do puller]**.
  - O puller (PR #44) não lê Releases: só lê tags `aprovada/` e artefatos do
    `ci-windows-packaging.yml` (`Invoke-ReleasePuller.ps1:135, 161-175`) **[P]**.
- **Opcional:** `actions/attest-build-provenance` para atestar a procedência **[I]**.

**Instalação no servidor da unidade:** fora deste repositório e fora deste plano. O operador confere
o SHA-256 com `Get-FileHash -Algorithm SHA256` antes de instalar, e o roteiro do
[laboratório](laboratorio.md) vale como ensaio desse procedimento.

## Implementação (PR #49) — decisões

Workflow: `.github/workflows/build-iperf3-windows.yml`.

### D-B1 — Disparo manual só a partir do branch padrão

- O `workflow_dispatch` só dispara se o arquivo existir no branch padrão. Antes do merge, a API
  responde `HTTP 404: workflow build-iperf3-windows.yml not found on the default branch` **[P]**.
- O arquivo tem **somente** `workflow_dispatch`.
- As provas no branch do PR usaram um gatilho `push` **temporário**, restrito ao próprio branch, num
  commit `TEMP` que foi removido depois.
- O arquivo final difere do provado **só** por esse gatilho. Isso aparece no `git diff` registrado
  no PR.

### D-B2 — `contents: write` por job, não por passo

- O GitHub Actions só aceita `permissions` por workflow ou por job, não por passo.
- O job `build` tem `contents: read`.
- A Release é criada num job separado, `publicar`:
  - depende do `build`;
  - roda só com `publicar=true`;
  - é o **único** com `contents: write`;
  - não compila nada: baixa o artefato, confere o `.sha256` e cria a Release.

### D-B3 — Tag da Release: `iperf3-v<tag>-cygwin.<número da execução>`

- O `.1` fixo do plano colidiria na segunda publicação.
- O número da execução (`GITHUB_RUN_NUMBER`) é único no workflow e liga a Release à execução que
  gerou o pacote.
- A Release usa `--latest=false` para não virar a "Latest" da aplicação.

### D-B4 — Ruído de "cookie" no log do servidor é inofensivo

- Na verificação funcional, `server.err` registra
  `iperf3: error - unable to receive cookie at server: Software caused connection abort`
  **[P, run 45191296655]**.
- A origem é a sonda de prontidão, que abre e fecha uma conexão TCP para saber se a porta 5201
  aceita.
- Não afeta nenhum resultado: as três medições seguintes completam e saem no `funcional.json`.
- Foi mantido assim para não alterar o arquivo já provado.

### SHAs das actions (I2, 2026-11-23)

| Action | Versão | SHA fixado | Origem |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | já usado no repositório; confere com a tag na API **[P]** |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | idem **[P]** |
| `actions/download-artifact` | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | idem **[P]** |
| `cygwin/cygwin-install-action` | v7 (2026-10-25) | `5a1b0cd107181fa6bb6bf3f90d500f4fb3132f18` | tag anotada `v7` desreferenciada na API **[P]** |

### Builds

**O hash oficial será o da primeira execução com `publicar=true` depois do merge.** As linhas abaixo
são provas no branch do PR: não foram publicadas e não servem para instalar.

| Data | Execução | Situação | Tag / commit iperf3 | Cygwin | `iperf3.exe` SHA-256 | zip SHA-256 |
|---|---|---|---|---|---|---|
| 2026-11-23 | [45191296655](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45191296655) | **prova, não publicado**. Pacote ainda sem `COPYING.LIB` | 3.22.1 / `acc0ed50` | 3.6.12-1 | `14384850c528f6a1153bf79cc4f298e11d3c3c342fa765b9ea8d1b236fca4c56` | `61d1968596b8c62c6b665f44b227b0bc723b34d996bb6ca2c09915ec03ab6b01` |
| 2026-11-23 | [45200078545](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45200078545) | **prova, não publicado**. Primeiro pacote com `COPYING.LIB`; constantes ainda sem aspas | 3.22.1 / `acc0ed50` | 3.6.12-1 | `1476a2ddb7ac3a402c1203de5933dd2566c3a844f77ac2e41c4f92f43d5b4594` | `6fe64b95d17ce961230a0c383780464af297b3c7fd6b60bc459d124d049efed8` |
| 2026-11-23 | [45200942215](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45200942215) | **prova, não publicado**. Conteúdo final do workflow, diferindo só pelo gatilho `push` temporário | 3.22.1 / `acc0ed50` | 3.6.12-1 | `c1e1aca3b288a13630d45043ec0ae600c204b50181d7d6997c3309d16a9cf236` | `49d21205825d9232d8bba316c7fa8b9f2e69c83cd146d90e6bc82c4768f6c2cc` |

**O build não é reproduzível bit a bit [P].** As três execuções compilaram o mesmo commit, com o
mesmo Cygwin e o mesmo gcc, e geraram três `iperf3.exe` com hashes diferentes. A causa provável é o
carimbo de data no cabeçalho PE e nos caminhos de build **[I]**.

Consequências:
- O hash que vale é o **da execução publicada**. Recompilar não reproduz um hash anterior, e o
  operador confere o hash contra a Release, não contra uma recompilação.
- Tornar o build reproduzível fica como melhoria futura, fora deste PR. Exigiria pelo menos
  `SOURCE_DATE_EPOCH` e `-Wl,--no-insert-timestamp`.

### Provas de reversão das travas

| Trava | Execução | Resultado |
|---|---|---|
| `IPERF_COMMIT` errado | [45192082462](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45192082462) | falha em "Conferir commit da tag" |
| `ALLOWED_DLLS` vazia | [45192269673](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45192269673) | `DLL fora da lista permitida: C:\cygwin\bin\cygwin1.dll` |
| SHA-256 do `COPYING.LIB` errado, sem aspas | [45200793971](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45200793971) | falha, mas o log mostra `esperado 0`: o YAML leu `000…0` como número. Por isso as constantes passaram a ficar entre aspas |
| SHA-256 do `COPYING.LIB` errado, entre aspas | [45201643187](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45201643187) | `SHA-256 do COPYING.LIB nao confere` (`esperado 0000…0000`) |
| Versão do runtime errada (`3.6.11-1`) | [45201759293](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45201759293) | `runtime Cygwin 3.6.12-1 difere de 3.6.11-1` |

Todos os commits `TEMP` foram revertidos.
