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

Escolha: **Cygwin**, no runner `windows-2022` **[I]**.

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

- **Esperado [I]:** só `cygwin1.dll`.
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
| cJSON (embutido em `src/cjson.{c,h}`) | MIT, cujo texto está no próprio `LICENSE` do iperf3 (linhas 43 em diante) **[P]** | coberto pelo arquivo acima |
| Runtime Cygwin (`cygwin1.dll`) | LGPLv3+ **[E, conhecimento geral; conferir no pacote instalado]** | `COPYING-cygwin.txt` + `CYGWIN-SOURCE.txt` com a versão exata e o link do pacote de fonte correspondente |
| `cyggcc_s-seh-1.dll` (se houver) | GPLv3 com GCC Runtime Library Exception **[E]** | `COPYING-gcc-runtime.txt` |

A LGPL exige oferecer o fonte da biblioteca distribuída. O arquivo `CYGWIN-SOURCE.txt` aponta para
o pacote de fonte da versão exata registrada no passo 2 **[I]**.

## Conteúdo do pacote

```
iperf3-<tag>-cygwin-x64-<run>.zip
├── iperf3.exe
├── cygwin1.dll
├── LICENSE-iperf3.txt
├── COPYING-cygwin.txt
├── CYGWIN-SOURCE.txt
├── BUILD-MANIFEST.txt   tag, commit, runner, versão do Cygwin e do gcc, flags do configure, run id
└── SHA256SUMS           de cada arquivo acima
```

## SHA-256 e onde o artefato fica

- O hash do zip e do `iperf3.exe` aparecem em quatro lugares:
  - no log do job;
  - no `SHA256SUMS`;
  - no corpo da release;
  - numa tabela neste documento, quando houver o primeiro build. Cada build aprovado ganha uma linha
    com data, tag, commit e hash.
- **Onde fica (proposta [I]):** como asset de uma **GitHub Release do nosso repositório**, com tag
  própria `iperf3-v3.22.1-cygwin.1`.
  - Artefato de workflow expira (90 dias por padrão) **[E]**, e baixar o zip exige token mesmo em
    repositório público **[E, memória do puller]**.
  - Release não expira, e o `SHA256SUMS` fica ao lado.
- **Opcional:** `actions/attest-build-provenance` para atestar a procedência **[I]**.
- **Gatilho:** só `workflow_dispatch`, nunca em push. Não há motivo para recompilar a cada commit do
  projeto **[I]**.

**Instalação no servidor da unidade:** fora deste repositório e fora deste plano. O operador confere
o SHA-256 com `Get-FileHash -Algorithm SHA256` antes de instalar, e o roteiro do
[laboratório](laboratorio.md) vale como ensaio desse procedimento.
