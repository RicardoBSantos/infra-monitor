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
| [design — icmp-nativo-windows](../superpowers/specs/2026-09-21-icmp-nativo-windows-design.md) | O design que este ciclo implementou: contrato `IcmpResult`/`StatusIcmp`, mapeamento de códigos Win32, componentes criados |

## Dívidas do ciclo

1. Nada detecta um período em que o monitoramento parou: se o processo cai, a ausência de medições
   é indistinguível de um monitor sem candidatos.
2. O formato de saída do `ping` do Linux não foi verificado em máquina Linux — a fixture do
   `iputils` existe nos testes marcada como formato de referência, não como formato confirmado.
3. A execução como conta de sistema (SYSTEM) não foi verificada: `schtasks /ru SYSTEM` devolveu
   `ERRO: Acesso negado.` nesta máquina, que não é administradora. Ver
   [icmp-falsos-positivos.md](icmp-falsos-positivos.md) para o comando e o raciocínio separado da
   verificação.
