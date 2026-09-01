F10 — Integração Geográfica do Mapa — Infra Monitor

1. Objetivo

Implementar no frontend Angular do Infra Monitor a integração real entre:

Unidade.codigoIbge
↓
Dashboard API
↓
GeoJSON municipal de Sergipe
↓
município correspondente
↓
StatusOperacionalUnidade
↓
Mapa

Esta fase deve substituir o gap state da F09 por uma visualização geográfica funcional sempre que a Unidade possuir codigoIbge.

Também deve atualizar o cadastro/edição de Unidade para permitir associação amigável a um município sem exigir que o operador conheça ou digite manualmente o código IBGE.

2. Pré-condições

Já foram concluídas:

F01 — Fundação Angular;

F02 — Design System + Application Shell;

F03 — Dashboard;

F04 — Unidades e Tipos;

F05 — Equipamentos;

F06 — Monitores;

F07 — Medições e Incidentes;

F08 — Notificações e Telegram;

F09 — Mapa base e auditoria visual;

B10 — Backend com codigoIbge.

Antes de alterar código:

revisar o projeto Angular atual;

revisar UnidadeApiService;

revisar models de Unidade;

revisar DTOs reais do backend após B10;

revisar MapaComponent;

revisar o GeoJSON real;

identificar exatamente qual propriedade do GeoJSON corresponde ao código IBGE;

revisar os DTOs reais de /dashboard/unidades;

verificar git status.

Não assumir o nome da propriedade do GeoJSON sem inspecionar o asset.

3. Fonte de verdade

Backend

O backend deve retornar codigoIbge em:

GET /api/v1/unidades
GET /api/v1/unidades/{id}
GET /api/v1/dashboard/unidades
GET /api/v1/dashboard/unidades/{id}

ou conforme implementação real da B10.

GeoJSON

Asset atual:

public/assets/maps/se-municipalities.geo.json

O código Angular deve comparar Unidade.codigoIbge com a propriedade real equivalente do GeoJSON.

Não usar nome do município como chave principal se houver código IBGE.

4. Models de Unidade

Atualizar models TypeScript reais para incluir:

codigoIbge: string | null;

nos DTOs pertinentes.

Não duplicar propriedades.

Não transformar o código em number.

5. Formulário de Unidade

Atualizar criação e edição.

O usuário NÃO deve precisar digitar manualmente o código IBGE.

Adicionar campo visual equivalente a:

Município

com opções extraídas do GeoJSON municipal.

Ao selecionar:

Aracaju

o form deve enviar internamente:

codigoIbge = "<codigo correspondente>"

Não pedir ambos Município e codigoIbge.

6. Fonte das opções de município

As opções podem ser carregadas do próprio GeoJSON já existente.

Criar uma camada simples para extrair:

nome do município
codigo IBGE

Ordenar alfabeticamente para o select.

Não hardcode uma lista paralela de municípios.

Não chamar API externa do IBGE.

7. Componente/helper geográfico

Pode ser criado um service/helper dedicado, por exemplo:

GeoMunicipioService

Responsabilidades possíveis:

carregar GeoJSON;

extrair municípios;

normalizar acesso ao código;

retornar nome por código;

retornar feature por código.

Não criar framework GIS genérico.

8. Cache do GeoJSON

Como o asset é estático, evitar múltiplos carregamentos desnecessários durante a mesma sessão.

Pode usar cache simples em memória no service.

Não introduzir state management complexo.

9. Edição de Unidade

Ao editar uma Unidade existente:

codigoIbge = "..."

o select deve abrir com o município correspondente selecionado.

Se:

codigoIbge = null

mostrar estado equivalente a:

Sem município associado

sem quebrar o formulário.

10. Código sem correspondência

Se backend retornar um codigoIbge que não exista no GeoJSON:

não quebrar o mapa;

não inventar município;

tratar como Unidade sem correspondência cartográfica;

exibir aviso discreto/diagnóstico quando necessário.

Documentar o gap no relatório.

11. Mapa

Atualizar /mapa.

Para cada Unidade retornada por:

GET /api/v1/dashboard/unidades

usar:

codigoIbge

para localizar a feature correspondente no GeoJSON.

12. Status da Unidade no mapa

Usar exclusivamente:

StatusOperacionalUnidade

retornado pela Dashboard API.

Valores:

DISPONIVEL
INDISPONIVEL
DEGRADADA
SEM_DADOS
SEM_EQUIPAMENTOS

Não recalcular.

13. Municípios sem Unidade

Municípios sem Unidade cadastrada devem manter aparência neutra.

Não classificá-los como SEM_EQUIPAMENTOS.

SEM_EQUIPAMENTOS é status de uma Unidade existente.

Município sem Unidade não possui status operacional do sistema.

14. Mais de uma Unidade no mesmo município

Como codigoIbge não é unique, pode existir:

N Unidades
→ mesmo município

O frontend deve suportar isso.

Não sobrescrever silenciosamente uma Unidade pela outra.

Para o município:

mostrar lista das Unidades associadas;

exibir status individual de cada Unidade;

não inventar status agregado municipal sem regra backend.

Se precisar de cor única do município, use solução visual neutra/indicativa ou baseada numa regra puramente de apresentação claramente documentada, sem reinterpretar status operacional.

Preferência: não criar um “status do município” novo.

15. Seleção no mapa

Ao clicar em município com Unidade(s):

mostrar painel/card com dados reais, por exemplo:

Município
Unidade(s)
Status
Total de equipamentos
Indicadores disponíveis

Somente campos retornados pela API.

16. Navegação

Para uma Unidade selecionada, permitir navegação para rota existente coerente.

Se não existir detalhe operacional /unidades/:id, usar a rota real disponível.

Não reintroduzir link quebrado corrigido na F09.

17. Municípios sem Unidade

Ao clicar num município sem Unidade, pode mostrar:

Nenhuma unidade cadastrada neste município.

Sem criar entidade fictícia.

18. Legenda

Reutilizar a legenda já existente.

Adicionar clareza entre:

município sem Unidade
Unidade SEM_DADOS
Unidade SEM_EQUIPAMENTOS

Não usar só cor.

19. Loading

Tratar separadamente:

carregamento do GeoJSON
carregamento da Dashboard API

A tela só deve entrar em success quando ambos os dados necessários estiverem disponíveis.

20. Error

Se GeoJSON falhar:

mostrar erro cartográfico;

não apresentar dados incompletos como sucesso.

Se Dashboard API falhar:

mostrar erro de dados operacionais;

não recalcular ou usar mocks.

21. Empty

Casos:

nenhuma Unidade cadastrada
Unidades existem mas nenhuma possui codigoIbge
parte das Unidades sem codigoIbge

Tratar cada caso de forma coerente.

22. Unidade sem codigoIbge

Unidades sem georreferenciamento devem continuar visíveis em uma lista/painel do mapa como:

Unidades sem localização

ou solução equivalente do design.

Não escondê-las silenciosamente.

23. Unidade com código inválido

Distinguir:

codigoIbge = null

de:

codigoIbge informado mas sem feature correspondente

O segundo caso indica inconsistência de dados.

Pode ser mostrado como aviso administrativo.

24. Filtro/seleção de Unidade

Se o mapa já possui filtros visuais, permitir filtrar/selecionar Unidade usando dados reais.

Não adicionar busca complexa sem necessidade.

25. Design

Preservar Claude Design e F09:

dark theme;

GeoJSON de Sergipe;

legenda;

painel lateral;

cards;

spacing;

tipografia;

responsividade.

Não redesenhar o mapa.

26. SVG

A F09 utilizou SVG nativo Angular.

Preservar essa abordagem se ela continuar adequada.

Não adicionar Leaflet/Mapbox apenas para associação por GeoJSON se não houver necessidade.

27. Acessibilidade

Cada região interativa deve ter:

foco quando viável;

nome acessível;

status textual;

interação por teclado quando possível.

Não depender apenas de hover.

28. Responsividade

Validar:

desktop;

tablet;

mobile.

No mobile, painel/lista deve ficar acessível mesmo que a interação direta no SVG seja limitada.

29. Testes — Geo service/helper

Cobrir:

carrega GeoJSON
extrai municípios
ordena por nome
encontra feature por codigoIbge
encontra nome por codigoIbge
código inexistente

30. Testes — formulário de Unidade

Cobrir:

create sem município
create com município
envio de codigoIbge
edit com código existente
edit sem código
código sem correspondência

31. Testes — Mapa

Cobrir:

loading GeoJSON
loading API
success
erro GeoJSON
erro API
nenhuma Unidade
Unidade com codigoIbge
Unidade sem codigoIbge
código inválido
mais de uma Unidade no mesmo município
seleção
navegação

32. Não implementar

Não implementar:

latitude/longitude;

marcadores pontuais;

geocoding;

API externa;

status agregado municipal inventado;

autenticação;

relatórios;

deploy.

33. Validação manual

Com backend e PostgreSQL de teste:

cadastrar Unidade com município;

confirmar codigoIbge salvo;

abrir /mapa;

confirmar município associado;

confirmar status real da Unidade;

clicar e visualizar dados;

testar Unidade sem município;

testar duas Unidades no mesmo município;

editar município da Unidade;

confirmar atualização do mapa.

34. Critérios de aceite

F10 está concluída quando:

models Angular incluem codigoIbge;

formulário de Unidade usa select de município;

município vem do GeoJSON, não hardcode;

request envia codigoIbge;

edição resolve código para município;

mapa associa Unidade por código IBGE;

status vem exclusivamente da Dashboard API;

município sem Unidade permanece neutro;

Unidade sem código continua visível fora do mapa;

múltiplas Unidades no mesmo município são suportadas;

nenhuma localização é inventada;

nenhuma API externa é usada;

testes passam;

build passa.

35. Entrega

F10 — Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

GeoJSON

Informar:

arquivo:
propriedade de código:
propriedade de nome:

Models

Listar alterações de codigoIbge.

Formulário de Unidade

Descrever:

select de município
origem das opções
valor enviado
edição
null

Geo service

Descrever service/helper criado.

Mapa

Descrever:

associação por codigoIbge
seleção
painel
navegação
status

Múltiplas Unidades

Descrever comportamento.

Unidades sem georreferenciamento

Descrever comportamento.

Status operacional

Confirmar:

Nenhum status operacional é recalculado no Angular.

API

Listar endpoints consumidos.

Testes

Informar comando, quantidade e resultado.

Build

Informar comando e resultado.

Git diff

Listar arquivos relevantes.

Pendências

Somente problemas reais da F10.

Próximos passos

Não implementar automaticamente novas features.