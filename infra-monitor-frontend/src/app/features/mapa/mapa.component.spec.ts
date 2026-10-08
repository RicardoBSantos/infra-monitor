import { DashboardEquipamento, DashboardUnidade } from '../../core/models/dashboard';
import { EquipmentOperationalStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { agruparUnidades, arcoEntre, camadasDeConexao, cliqueVeioDeMarcador, conexoesDesenhaveis, contarPorStatus, equipamentosAfetados, faseVaiEVolta, interpolar, pontoNoArco, rotuloDaUnidade, rotuloDoMunicipio } from './mapa.component';
import { Municipio } from '../../core/services/geo-municipio.service';

const geoJson={type:'FeatureCollection',features:[{type:'Feature',properties:{id:'2800308',name:'Aracaju'},geometry:{type:'Polygon',coordinates:[[[-38,-10],[-37,-10],[-37,-11],[-38,-10]]] }},{type:'Feature',properties:{id:'2800100',name:'Amparo'},geometry:{type:'Polygon',coordinates:[[[-38,-11],[-37,-11],[-37,-12],[-38,-11]]]}}]};
const unit: DashboardUnidade={id:1,nome:'Matriz',codigoIbge:'2800308',ativo:true,status:UnitOperationalStatus.Available,equipamentosTotal:1,equipamentosAtivos:1,equipamentosDisponiveis:1,equipamentosDegradados:0,equipamentosIndisponiveis:0,equipamentosSemDados:0,equipamentosSemMonitoramento:0,equipamentosEmManutencao:0,incidentesAbertos:0,latitude:null,longitude:null,conectaAUnidadeId:null};
const municipio=(codigoIbge:string,nome:string):Municipio=>({codigoIbge,nome,uf:'SE',feature:geoJson.features[0] as never});

/*
 * So funcao pura aqui. Desde a migracao para o MapLibre (N05) o mapa e um canvas WebGL, que o jsdom
 * nao tem: montar o componente neste ambiente falha na criacao do contexto grafico, e os remendos
 * antigos (forjar clientWidth/clientHeight para o Leaflet projetar) nao alcancam isso.
 *
 * O que era testado montando o componente — selecao, painel da unidade, rotas, estados de erro —
 * passou para `e2e/n05-mapa-maplibre.cjs`, que roda contra a aplicacao real com WebGL de verdade.
 * O cruzamento entre cartografia e unidades continua aqui porque nunca dependeu de DOM.
 */
describe('agrupamento de unidades por municipio',()=>{
  const fonte=[municipio('2800308','Aracaju'),municipio('2800100','Amparo')];

  it('separa unidade sem codigo IBGE de unidade com codigo fora da cartografia',()=>{
    const r=agruparUnidades(fonte,[{...unit,nome:'Sem local',codigoIbge:null},{...unit,id:2,nome:'Inválida',codigoIbge:'9999999'},{...unit,id:3,nome:'Datacenter'}]);
    expect(r.semLocalizacao.map(u=>u.nome)).toEqual(['Sem local']);
    expect(r.semCorrespondencia.map(u=>u.nome)).toEqual(['Inválida']);
    expect(r.municipios.find(m=>m.codigoIbge==='2800308')?.units.map(u=>u.nome)).toEqual(['Datacenter']);
    expect(r.municipios.find(m=>m.codigoIbge==='2800100')?.units).toEqual([]);
  });

  /*
   * O teste do tom do municipio saiu com a funcao: o poligono nao carrega mais status (N07). O que
   * ele protegia de fato — que o agrupamento NAO recalcula status, so acomoda a unidade no
   * municipio — continua coberto pelo teste acima, que confere a lista `units` de cada municipio.
   */

  it('rotula o municipio para leitor de tela com e sem unidade',()=>{
    const r=agruparUnidades(fonte,[unit]);
    expect(rotuloDoMunicipio(r.municipios.find(m=>m.codigoIbge==='2800308')!)).toBe('Aracaju: 1 unidade');
    expect(rotuloDoMunicipio(r.municipios.find(m=>m.codigoIbge==='2800100')!)).toBe('Amparo: nenhuma unidade cadastrada');
  });
});

const equipamento=(id:number,nome:string,status:EquipmentOperationalStatus):DashboardEquipamento=>({id,nome,ip:'10.0.0.'+id,hostname:null,localizacao:null,ativo:true,status,tipoEquipamento:{id:2,nome:'Switch'},emManutencao:false,monitoresAtivos:1,incidentesAbertos:0,ultimaMedicao:null});

describe('painel lateral',()=>{
  it('conta unidades por status na ordem de severidade e omite status sem ocorrencia',()=>{
    const r=contarPorStatus([
      {...unit,status:UnitOperationalStatus.Available},
      {...unit,status:UnitOperationalStatus.Unavailable},
      {...unit,status:UnitOperationalStatus.Available},
      {...unit,status:UnitOperationalStatus.Degraded},
    ]);
    expect(r).toEqual([
      {status:UnitOperationalStatus.Unavailable,total:1},
      {status:UnitOperationalStatus.Degraded,total:1},
      {status:UnitOperationalStatus.Available,total:2},
    ]);
  });

  it('trata DESABILITADO como decisao administrativa, nao como equipamento afetado',()=>{
    const r=equipamentosAfetados([
      equipamento(1,'ok',EquipmentOperationalStatus.Available),
      equipamento(2,'desligado',EquipmentOperationalStatus.Disabled),
      equipamento(3,'caiu',EquipmentOperationalStatus.Unavailable),
      equipamento(4,'manutencao',EquipmentOperationalStatus.Maintenance),
      equipamento(5,'lento',EquipmentOperationalStatus.Degraded),
    ]);
    expect(r.map(e=>e.nome)).toEqual(['caiu','manutencao','lento']);
  });
});

/*
 * N06 — as linhas hub->unidade. A guarda das duas pontas nao e detalhe: uma unidade tem coordenada
 * e a outra nao com muito mais frequencia do que as duas terem, porque o cadastro nunca exigiu
 * coordenada. Meia linha, saindo do nada, seria lida como ligacao para fora do estado.
 */
describe('linhas de conexao hub->unidade',()=>{
  const comCoordenada=(id:number,lat:number,lon:number,pai:number|null):DashboardUnidade=>
    ({...unit,id,nome:`U${id}`,latitude:lat,longitude:lon,conectaAUnidadeId:pai});

  it('desenha um arco por unidade conectada, do pai para o filho',()=>{
    const r=conexoesDesenhaveis([comCoordenada(1,-10.9,-37.0,null),comCoordenada(2,-11.2,-37.4,1)]);
    expect(r.length).toBe(1);
    const g=r[0].geometry as {type:string;coordinates:[number,number][]};
    expect(g.type).toBe('LineString');
    /* As PONTAS continuam exatas: e delas que `montarPings` reconstroi a curva do ping, e e nelas
     * que a linha tem de encostar no marcador. O miolo e o arco amostrado. */
    expect(g.coordinates[0]).toEqual([-37.0,-10.9]);
    expect(g.coordinates[g.coordinates.length-1]).toEqual([-37.4,-11.2]);
    expect(g.coordinates.length).toBeGreaterThan(2);
    // `status` e o do FILHO: e ele que o ping carrega e que o fim do gradiente assume.
    expect(r[0].properties).toEqual({de:1,para:2,status:UnitOperationalStatus.Available});
  });

  it('nao desenha quando falta coordenada em qualquer uma das duas pontas',()=>{
    const paiSemCoordenada=[{...unit,id:1,latitude:null,longitude:null},comCoordenada(2,-11.2,-37.4,1)];
    const filhoSemCoordenada=[comCoordenada(1,-10.9,-37.0,null),{...unit,id:2,latitude:null,longitude:null,conectaAUnidadeId:1}];
    expect(conexoesDesenhaveis(paiSemCoordenada)).toEqual([]);
    expect(conexoesDesenhaveis(filhoSemCoordenada)).toEqual([]);
  });

  it('ignora raiz e pai ausente da lista sem quebrar',()=>{
    expect(conexoesDesenhaveis([comCoordenada(1,-10.9,-37.0,null)])).toEqual([]);
    expect(conexoesDesenhaveis([comCoordenada(2,-11.2,-37.4,99)])).toEqual([]);
  });

  /* Coordenada 0 e valida (Golfo da Guine). Guarda por veracidade a descartaria em silencio. */
  it('aceita zero como coordenada valida',()=>{
    expect(conexoesDesenhaveis([comCoordenada(1,0,0,null),comCoordenada(2,-11.2,-37.4,1)]).length).toBe(1);
  });
});

describe('rotulo do marcador de unidade',()=>{
  /*
   * Incidentes abertos entraram no rotulo junto com a dica de relance (N07). A dica e aria-hidden,
   * entao este rotulo E o canal do leitor de tela: sem o numero aqui, o mouse teria um dado que o
   * teclado nao tem.
   */
  it('usa o status por extenso e leva os mesmos dados da dica',()=>{
    expect(rotuloDaUnidade({...unit,nome:'Sede',status:UnitOperationalStatus.Maintenance,equipamentosTotal:7,incidentesAbertos:2}))
      .toBe('Sede: Em manutenção, 7 equipamentos, 2 incidentes abertos');
  });
});

/*
 * N07 — o movimento do ping. Puro de proposito: e a unica parte da animacao que pode dar errado
 * silenciosamente (um ping que nao chega na ponta, ou que "salta" ao virar o ciclo) e que nao
 * aparece em captura de tela.
 */
describe('movimento do ping na linha de conexao',()=>{
  it('vai e volta dentro de um ciclo, sem salto na virada',()=>{
    expect(faseVaiEVolta(0)).toBe(0);
    expect(faseVaiEVolta(0.25)).toBe(0.5);
    expect(faseVaiEVolta(0.5)).toBe(1);     // chegou na unidade
    expect(faseVaiEVolta(0.75)).toBe(0.5);
    expect(faseVaiEVolta(1)).toBe(0);       // voltou ao hub, sem descontinuidade
  });

  /* Dois pings por linha, defasados de 0,5: quando um esta no hub o outro esta na ponta. */
  it('mantem os dois pings da mesma linha em fases opostas',()=>{
    expect(faseVaiEVolta(0) + faseVaiEVolta(0.5)).toBe(1);
    expect(faseVaiEVolta(0.3) + faseVaiEVolta(0.8)).toBeCloseTo(1, 10);
  });

  /* O relogio nunca volta, mas o cast de `performance.now` e o modulo negativo ja morderam antes. */
  it('aceita ciclo negativo sem inverter o sentido',()=>{
    expect(faseVaiEVolta(-0.25)).toBe(0.5);
  });

  it('interpola o par [lng, lat] nas duas pontas e no meio',()=>{
    const hub:[number,number]=[-37,-10], filha:[number,number]=[-38,-11];
    expect(interpolar(hub,filha,0)).toEqual(hub);
    expect(interpolar(hub,filha,1)).toEqual(filha);
    expect(interpolar(hub,filha,0.5)).toEqual([-37.5,-10.5]);
  });
});

/*
 * Arco (D17). A linha deixou de ser reta, e o ping tem de correr EXATAMENTE sobre o desenho — se as
 * duas contas divergissem, o ponto flutuaria ao lado da linha e ninguem veria por que.
 */
describe('arco da conexao',()=>{
  const hub:[number,number]=[-37,-10], filha:[number,number]=[-38,-11];

  it('encosta nas duas pontas e sai da reta no meio',()=>{
    expect(pontoNoArco(hub,filha,0)).toEqual(hub);
    expect(pontoNoArco(hub,filha,1)).toEqual(filha);
    const meio=pontoNoArco(hub,filha,0.5);
    const cordaNoMeio=interpolar(hub,filha,0.5);
    expect(meio).not.toEqual(cordaNoMeio);
  });

  it('afasta-se da corda proporcionalmente ao comprimento: mesma barriga em toda conexao',()=>{
    const desvio=(a:[number,number],b:[number,number]):number=>{
      const meio=pontoNoArco(a,b,0.5), corda=interpolar(a,b,0.5);
      const comprimento=Math.hypot(b[0]-a[0],b[1]-a[1]);
      return Math.hypot(meio[0]-corda[0],meio[1]-corda[1])/comprimento;
    };
    // Conexao curta e conexao dez vezes mais longa: a razao desvio/comprimento e a mesma.
    expect(desvio(hub,filha)).toBeCloseTo(desvio([0,0],[10,10]),12);
  });

  it('arqueia sempre para o mesmo lado, independente do sentido do par',()=>{
    /* Lado = sinal do produto vetorial (corda x desvio). Se invertesse com o sentido, metade das
     * conexoes do mesmo hub curvaria para um lado e metade para o outro. */
    const lado=(a:[number,number],b:[number,number]):number=>{
      const meio=pontoNoArco(a,b,0.5), corda=interpolar(a,b,0.5);
      return Math.sign((b[0]-a[0])*(meio[1]-corda[1])-(b[1]-a[1])*(meio[0]-corda[0]));
    };
    expect(lado(hub,filha)).toBe(lado(filha,hub));
  });

  it('amostra o arco como polilinha com as pontas exatas',()=>{
    const pontos=arcoEntre(hub,filha);
    expect(pontos.length).toBeGreaterThan(2);
    expect(pontos[0]).toEqual(hub);
    expect(pontos[pontos.length-1]).toEqual(filha);
    // Cada vertice esta sobre a curva que o ping percorre: uma conta so, dois consumidores.
    expect(pontos[8]).toEqual(pontoNoArco(hub,filha,8/(pontos.length-1)));
  });

  it('degenera sem quebrar quando as duas pontas coincidem',()=>{
    expect(pontoNoArco(hub,hub,0.5)).toEqual(hub);
  });
});

describe('camada de conexao (D18)',()=>{
  it('e uma unica camada, sem filtro por status',()=>{
    const camadas=camadasDeConexao();
    expect(camadas.length).toBe(1);
    expect(camadas[0].id).toBe('conexoes-linha');
    expect((camadas[0] as {filter?:unknown}).filter).toBeUndefined();
  });

  it('pinta a linha inteira com a cor do status da feature',()=>{
    const paint=(camadasDeConexao()[0] as unknown as {paint:Record<string,unknown>}).paint;
    expect(paint['line-gradient']).toBeUndefined();
    const cor=paint['line-color'] as unknown[];
    // Corpo inteiro do match, na ordem exata: um toContain/toBe isolado passaria com o par
    // status/cor invertido, e o estilo so quebraria em runtime.
    expect(cor).toEqual(['match', ['get','status'],
      'DISPONIVEL', '#34c77b',
      'INDISPONIVEL', '#e5484d',
      'DEGRADADA', '#e8a33d',
      'SEM_DADOS', '#8797a6',
      'SEM_EQUIPAMENTOS', '#667b8b',
      'EM_MANUTENCAO', '#7fadff',
      '#8797a6']);
  });
});

/*
 * O `click` de camada do MapLibre deriva do mesmo `click` DOM que acionou o marcador: o alvo
 * original é o que separa "clique na unidade" de "clique no polígono". Comportamento real (a ordem
 * dos dois handlers, o painel) está em `e2e/mapa-marcador-ibge-divergente.cjs`.
 */
describe('cliqueVeioDeMarcador',()=>{
  it('botão de unidade, filho dele e alvo de município contam como marcador',()=>{
    const unidade=document.createElement('button'); unidade.className='map__unidade';
    const dica=document.createElement('span'); unidade.appendChild(dica);
    const municipio=document.createElement('button'); municipio.className='map__alvo';
    expect(cliqueVeioDeMarcador(unidade)).toBe(true);
    expect(cliqueVeioDeMarcador(dica)).toBe(true);
    expect(cliqueVeioDeMarcador(municipio)).toBe(true);
  });
  it('canvas e null não são marcador',()=>{
    expect(cliqueVeioDeMarcador(document.createElement('canvas'))).toBe(false);
    expect(cliqueVeioDeMarcador(null)).toBe(false);
  });
});
