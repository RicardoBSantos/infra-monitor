import { DashboardEquipamento, DashboardUnidade } from '../../core/models/dashboard';
import { EquipmentOperationalStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { agruparUnidades, conexoesDesenhaveis, contarPorStatus, equipamentosAfetados, rotuloDaUnidade, rotuloDoMunicipio, toneDoMunicipio } from './mapa.component';
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

  it('deriva o tom do municipio sem recalcular status da unidade',()=>{
    const r=agruparUnidades(fonte,[{...unit,status:UnitOperationalStatus.Unavailable}]);
    const aracaju=r.municipios.find(m=>m.codigoIbge==='2800308')!;
    const amparo=r.municipios.find(m=>m.codigoIbge==='2800100')!;
    expect(toneDoMunicipio(aracaju)).toBe('indisponivel');
    expect(toneDoMunicipio(amparo)).toBe('none');
    expect(toneDoMunicipio({...aracaju,units:[unit,unit]})).toBe('multiple');
  });

  it('rotula o municipio para leitor de tela com e sem unidade',()=>{
    const r=agruparUnidades(fonte,[unit]);
    expect(rotuloDoMunicipio(r.municipios.find(m=>m.codigoIbge==='2800308')!)).toBe('Aracaju: 1 unidade(s)');
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

  it('desenha um segmento por unidade conectada, do pai para o filho',()=>{
    const r=conexoesDesenhaveis([comCoordenada(1,-10.9,-37.0,null),comCoordenada(2,-11.2,-37.4,1)]);
    expect(r.length).toBe(1);
    expect(r[0].geometry).toEqual({type:'LineString',coordinates:[[-37.0,-10.9],[-37.4,-11.2]]});
    expect(r[0].properties).toEqual({de:1,para:2});
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
  it('usa o status por extenso, nao o enum cru',()=>{
    expect(rotuloDaUnidade({...unit,nome:'Sede',status:UnitOperationalStatus.Maintenance,equipamentosTotal:7}))
      .toBe('Sede: Em manutenção, 7 equipamento(s)');
  });
});
