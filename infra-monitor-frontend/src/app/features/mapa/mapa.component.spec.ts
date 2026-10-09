import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DashboardUnidade } from '../../core/models/dashboard';
import { EquipmentOperationalStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { MapaComponent, agruparUnidades, contarPorStatus, equipamentosAfetados, rotuloDoMunicipio, toneDoMunicipio } from './mapa.component';
import { DashboardEquipamento } from '../../core/models/dashboard';
import { Municipio } from '../../core/services/geo-municipio.service';

const geoJson={type:'FeatureCollection',features:[{type:'Feature',properties:{id:'2800308',name:'Aracaju'},geometry:{type:'Polygon',coordinates:[[[-38,-10],[-37,-10],[-37,-11],[-38,-10]]] }},{type:'Feature',properties:{id:'2800100',name:'Amparo'},geometry:{type:'Polygon',coordinates:[[[-38,-11],[-37,-11],[-37,-12],[-38,-11]]]}}]};
const unit: DashboardUnidade={id:1,nome:'Matriz',codigoIbge:'2800308',ativo:true,status:UnitOperationalStatus.Available,equipamentosTotal:1,equipamentosAtivos:1,equipamentosDisponiveis:1,equipamentosDegradados:0,equipamentosIndisponiveis:0,equipamentosSemDados:0,equipamentosSemMonitoramento:0,equipamentosEmManutencao:0,incidentesAbertos:0,latitude:null,longitude:null};
const municipio=(codigoIbge:string,nome:string):Municipio=>({codigoIbge,nome,uf:'SE',feature:geoJson.features[0] as never});

/*
 * O cruzamento entre cartografia e unidades vive em funcoes puras exportadas, e e testado aqui sem
 * DOM: o Leaflet renderiza fora do template Angular, e o jsdom nao faz layout: sem largura e altura
 * de container, `fitBounds` nao tem como projetar. Os testes de montagem abaixo compensam isso
 * fixando o tamanho do container; a logica de negocio nao depende desse remendo.
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

describe('MapaComponent',()=>{
  let http:HttpTestingController;
  let tamanho:{width:PropertyDescriptor|undefined;height:PropertyDescriptor|undefined};

  beforeEach(async()=>{
    // jsdom nao calcula layout: sem isto todo elemento mede 0x0 e o Leaflet nao consegue projetar.
    tamanho={width:Object.getOwnPropertyDescriptor(HTMLElement.prototype,'clientWidth'),height:Object.getOwnPropertyDescriptor(HTMLElement.prototype,'clientHeight')};
    Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get:()=>800});
    Object.defineProperty(HTMLElement.prototype,'clientHeight',{configurable:true,get:()=>600});
    await TestBed.configureTestingModule({imports:[MapaComponent],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([])]}).compileComponents();
    http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>{
    http.verify();
    if(tamanho.width)Object.defineProperty(HTMLElement.prototype,'clientWidth',tamanho.width);
    if(tamanho.height)Object.defineProperty(HTMLElement.prototype,'clientHeight',tamanho.height);
  });

  function create(){const f=TestBed.createComponent(MapaComponent);f.detectChanges();return f;}
  function respond(units=[unit]){http.expectOne('assets/maps/se-municipalities.geo.json').flush(geoJson);http.expectOne('http://localhost:8080/api/v1/dashboard/unidades').flush(units);}
  /* Selecionar um municipio de uma unidade so ja seleciona a unidade, e isso dispara a busca dos
     equipamentos. Toda interacao de selecao precisa consumir essa chamada, senao o verify() falha. */
  function flushEquipamentos(unidadeId:number,content:DashboardEquipamento[]=[]){
    http.expectOne(r=>r.url.includes(`/dashboard/unidades/${unidadeId}/equipamentos`))
      .flush({content,totalElements:content.length,totalPages:1,size:200,number:0});
  }

  it('waits for both sources and renders API status on its matching code',()=>{
    const f=create();
    expect(f.nativeElement.textContent).toContain('Carregando cartografia');
    respond();f.detectChanges();
    expect(f.nativeElement.querySelectorAll('svg path').length).toBe(2);
    expect(f.nativeElement.querySelector('[data-codigo-ibge="2800308"]')?.getAttribute('class')).toContain('disponivel');
  });

  /* A selecao ja substituiu o tom do municipio, e o azul dela era quase o de "Em manutencao": o
     operador nao conseguia distinguir o que selecionou do que esta em janela. Agora sao duas
     classes somadas, e o status tem de sobreviver ao clique. */
  it('soma a selecao ao status em vez de substituir a cor do municipio',()=>{
    const f=create();
    respond([{...unit,status:UnitOperationalStatus.Maintenance}]);
    f.detectChanges();
    // Selecionar remonta o mapa: o no de antes do clique fica orfao, so a consulta nova ve o SVG vivo.
    const alvo=()=>f.nativeElement.querySelector('[data-codigo-ibge="2800308"]') as SVGPathElement;
    alvo().dispatchEvent(new MouseEvent('click',{bubbles:true}));
    f.detectChanges();
    flushEquipamentos(1);
    f.detectChanges();
    const classes=alvo().getAttribute('class')!.split(' ');
    expect(classes).toContain('map__municipio--em-manutencao');
    expect(classes).toContain('map__municipio--selected');
  });

  /*
   * Regressao de acessibilidade que ja aconteceu: `montarMapa` terminava chamando `aplicarTons`,
   * que le `selected()`, e com isso o effect de montagem passava a depender da selecao. Cada
   * clique destruia a camada, e o municipio focado saia do DOM levando o foco para o `body` — o
   * operador de teclado perdia a posicao a cada selecao. Fixamos o contrato aqui: selecionar nao
   * remonta o mapa, nao troca o no e nao move o foco.
   */
  it('preserva o no e o foco do municipio ao selecionar pelo teclado',()=>{
    const f=create();respond();f.detectChanges();
    const antes=f.nativeElement.querySelector('[data-codigo-ibge="2800308"]') as SVGElement;
    antes.focus();
    expect(document.activeElement).toBe(antes);
    antes.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    f.detectChanges();
    flushEquipamentos(1);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-codigo-ibge="2800308"]')).toBe(antes);
    expect(document.activeElement).toBe(antes);
    expect(antes.getAttribute('class')).toContain('map__municipio--selected');
  });

  it('mantem o municipio focavel e acionavel por teclado',()=>{
    const f=create();respond();f.detectChanges();
    const path=f.nativeElement.querySelector('[data-codigo-ibge="2800308"]') as SVGPathElement;
    expect(path.getAttribute('tabindex')).toBe('0');
    expect(path.getAttribute('role')).toBe('button');
    expect(path.getAttribute('aria-label')).toBe('Aracaju: 1 unidade(s)');
    path.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    f.detectChanges();
    flushEquipamentos(1);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Matriz');
  });

  it('keeps empty municipalities neutral and lists unmapped units without recalculating status',()=>{
    const f=create();
    respond([{...unit,nome:'Sem local',codigoIbge:null,status:UnitOperationalStatus.NoData},{...unit,id:2,nome:'Inválida',codigoIbge:'9999999'},{...unit,id:3,nome:'Datacenter',codigoIbge:'2800308',status:UnitOperationalStatus.Unavailable}]);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Unidades sem localização');
    expect(f.nativeElement.textContent).toContain('Associação geográfica não encontrada');
    expect(f.nativeElement.querySelector('[data-codigo-ibge="2800100"]')?.getAttribute('class')).toContain('none');
    (f.nativeElement.querySelector('[data-codigo-ibge="2800308"]') as SVGPathElement).dispatchEvent(new MouseEvent('click',{bubbles:true}));
    f.detectChanges();
    flushEquipamentos(3);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Datacenter');
    expect(f.nativeElement.textContent).toContain('Indisponível');
  });

  it('shows cartography for zero units',()=>{const f=create();respond([]);f.detectChanges();expect(f.nativeElement.textContent).toContain('Nenhuma unidade retornada');});

  it('reports a geographic source error',()=>{const f=create();http.expectOne('assets/maps/se-municipalities.geo.json').flush({}, {status:500,statusText:'Error'});http.expectOne('http://localhost:8080/api/v1/dashboard/unidades').flush([]);f.detectChanges();expect(f.nativeElement.textContent).toContain('Erro ao carregar mapa');});

  it('seleciona a unica unidade do municipio e lista so os equipamentos afetados',()=>{
    const f=create();respond();f.detectChanges();
    (f.nativeElement.querySelector('[data-codigo-ibge="2800308"]') as SVGPathElement).dispatchEvent(new MouseEvent('click',{bubbles:true}));
    f.detectChanges();
    http.expectOne(r=>r.url.includes('/dashboard/unidades/1/equipamentos')).flush({content:[
      equipamento(1,'SW-OK',EquipmentOperationalStatus.Available),
      equipamento(2,'SW-CAIU',EquipmentOperationalStatus.Unavailable),
    ],totalElements:2,totalPages:1,size:200,number:0});
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('UNIDADE SELECIONADA');
    expect(f.nativeElement.textContent).toContain('SW-CAIU');
    expect(f.nativeElement.textContent).not.toContain('SW-OK');
  });

  it('leva Ver unidade e Incidentes para as rotas que ja existem',async()=>{
    const f=create();respond();f.detectChanges();
    (f.nativeElement.querySelector('[data-codigo-ibge="2800308"]') as SVGPathElement).dispatchEvent(new MouseEvent('click',{bubbles:true}));
    f.detectChanges();
    http.expectOne(r=>r.url.includes('/equipamentos')).flush({content:[],totalElements:0,totalPages:0,size:200,number:0});
    f.detectChanges();
    const router=TestBed.inject(Router);
    const navigate=vi.spyOn(router,'navigate').mockResolvedValue(true);
    const botoes=[...f.nativeElement.querySelectorAll('.unit-panel__acoes button')] as HTMLButtonElement[];
    botoes[0].click();
    expect(navigate).toHaveBeenCalledWith(['/unidades',1]);
    botoes[1].click();
    // A lista de Incidentes nao aceita filtro por link; a aba da unidade entrega o mesmo recorte.
    expect(navigate).toHaveBeenCalledWith(['/unidades',1,'incidentes']);
  });

  it('nao mostra painel de unidade quando o municipio tem mais de uma',()=>{
    const f=create();
    respond([{...unit,id:1,nome:'Sede'},{...unit,id:2,nome:'Escola'}]);
    f.detectChanges();
    (f.nativeElement.querySelector('[data-codigo-ibge="2800308"]') as SVGPathElement).dispatchEvent(new MouseEvent('click',{bubbles:true}));
    f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('UNIDADE SELECIONADA');
    (f.nativeElement.querySelectorAll('.unit-list__escolha')[1] as HTMLButtonElement).click();
    f.detectChanges();
    http.expectOne(r=>r.url.includes('/dashboard/unidades/2/equipamentos')).flush({content:[],totalElements:0,totalPages:0,size:200,number:0});
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('UNIDADE SELECIONADA');
    expect(f.nativeElement.textContent).toContain('Nenhum equipamento afetado');
  });

  it('desmonta o mapa ao destruir o componente, sem deixar container inicializado',()=>{
    const f=create();respond();f.detectChanges();
    const container=f.nativeElement.querySelector('.map') as HTMLElement;
    expect(container.classList.contains('leaflet-container')).toBe(true);
    f.destroy();
    expect(container.querySelector('svg path')).toBeNull();
  });
});
