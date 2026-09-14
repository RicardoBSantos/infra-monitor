import { DashboardEquipamento, DashboardUnidade } from '../../core/models/dashboard';
import { EquipmentOperationalStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { agruparUnidades, contarPorStatus, equipamentosAfetados, rotuloDoMunicipio, toneDoMunicipio } from './mapa.component';
import { Municipio } from '../../core/services/geo-municipio.service';

const geoJson={type:'FeatureCollection',features:[{type:'Feature',properties:{id:'2800308',name:'Aracaju'},geometry:{type:'Polygon',coordinates:[[[-38,-10],[-37,-10],[-37,-11],[-38,-10]]] }},{type:'Feature',properties:{id:'2800100',name:'Amparo'},geometry:{type:'Polygon',coordinates:[[[-38,-11],[-37,-11],[-37,-12],[-38,-11]]]}}]};
const unit: DashboardUnidade={id:1,nome:'Matriz',codigoIbge:'2800308',ativo:true,status:UnitOperationalStatus.Available,equipamentosTotal:1,equipamentosAtivos:1,equipamentosDisponiveis:1,equipamentosDegradados:0,equipamentosIndisponiveis:0,equipamentosSemDados:0,equipamentosSemMonitoramento:0,equipamentosEmManutencao:0,incidentesAbertos:0,latitude:null,longitude:null};
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
