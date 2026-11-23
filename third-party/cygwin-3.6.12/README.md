# cygwin 3.6.12 — `COPYING.LIB`

Texto da LGPLv3 referenciado pelo `CYGWIN_LICENSE` do runtime Cygwin
(`cygwin1.dll`), que acompanha o pacote do iperf3 para Windows. O pacote `cygwin`
instala `COPYING` e `CYGWIN_LICENSE`, mas **não** instala o `COPYING.LIB`. Por
isso o arquivo está versionado aqui. Workflow: `.github/workflows/build-iperf3-windows.yml`.

| Item | Valor |
|---|---|
| Arquivo | `COPYING.LIB`, copiado byte a byte e sem normalizar fim de linha (`third-party/.gitattributes`) |
| SHA-256 | `da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768` |
| Origem oficial | `https://cygwin.com/cgit/newlib-cygwin/plain/winsup/COPYING.LIB?h=cygwin-3.6.12` |
| Conferência cruzada | `github.com/cygwin/cygwin` (espelho), tag `cygwin-3.6.12` → commit `ed54dcfd953ac0798802d3ef9deec5ff11edb47b`, `winsup/COPYING.LIB`: mesmo SHA-256 |
| Versão do runtime | `cygwin 3.6.12-1` |
| Conferido em | 2026-11-23 |

Na mesma data, o `CYGWIN_LICENSE` dessa tag foi conferido como idêntico ao
instalado pelo pacote `cygwin 3.6.12-1`.

**Trocar a versão do runtime exige trocar este diretório:**
1. criar `third-party/cygwin-<nova>/` com o `COPYING.LIB` da tag nova;
2. atualizar `CYGWIN_RUNTIME_VERSION` e `CYGWIN_COPYING_LIB_SHA256` no workflow.

O job falha se a versão instalada ou o hash não conferirem.
