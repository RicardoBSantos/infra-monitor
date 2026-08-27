import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EquipamentoDetailComponent } from './equipamento-detail.component';
describe('EquipamentoDetailComponent',()=>{let http:HttpTestingController;beforeEach(async()=>{await TestBed.configureTestingModule({imports:[EquipamentoDetailComponent],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([])]}).compileComponents();http=TestBed.inject(HttpTestingController);});afterEach(()=>http.verify());it('renders a not-found state for an invalid route id',()=>{const f=TestBed.createComponent(EquipamentoDetailComponent);f.detectChanges();expect(f.nativeElement.textContent).toContain('Equipamento não encontrado');});});
