import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { take } from 'rxjs';
import { isApiError } from '../../core/models/api-error';
import { EquipamentoResponse } from '../../core/models/equipamento';
import { EquipamentoApiService } from '../../core/services/equipamento-api.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { MonitorManagementComponent } from '../monitores/monitor-management.component';
import { AuthStateService } from '../../core/services/auth-state.service';
type State='loading'|'success'|'error'|'not-found';
@Component({selector:'app-equipamento-detail',imports:[DatePipe,RouterLink,ConfirmDialogComponent,MonitorManagementComponent],changeDetection:ChangeDetectionStrategy.OnPush,templateUrl:'./equipamento-detail.component.html',styleUrl:'./equipamento-detail.component.scss'})
export class EquipamentoDetailComponent {
 private readonly api=inject(EquipamentoApiService);private readonly route=inject(ActivatedRoute);private readonly router=inject(Router);protected readonly authState=inject(AuthStateService);protected readonly item=signal<EquipamentoResponse|null>(null);protected readonly state=signal<State>('loading');protected readonly error=signal<string|null>(null);protected readonly acting=signal(false);protected readonly deleting=signal(false);protected readonly confirm=signal(false);
 constructor(){const id=Number(this.route.snapshot.paramMap.get('id'));if(!Number.isInteger(id)||id<1){this.state.set('not-found');return;}this.load(id);}
 protected load(id=this.item()?.id):void{if(!id)return;this.state.set('loading');this.error.set(null);this.api.getById(id).pipe(take(1)).subscribe({next:x=>{this.item.set(x);this.state.set('success');},error:e=>{if(e instanceof HttpErrorResponse&&isApiError(e.error)&&e.error.code==='RESOURCE_NOT_FOUND')this.state.set('not-found');else{this.error.set(messageFrom(e));this.state.set('error');}}});}
 protected toggle():void{const item=this.item();if(!item||this.acting())return;this.acting.set(true);(item.ativo?this.api.deactivate(item.id):this.api.activate(item.id)).pipe(take(1)).subscribe({next:x=>{this.item.set(x);this.acting.set(false);},error:e=>{this.error.set(messageFrom(e));this.acting.set(false);}});}
 protected delete():void{const item=this.item();if(!item||this.deleting())return;this.deleting.set(true);this.api.delete(item.id).pipe(take(1)).subscribe({next:()=>this.router.navigate(['/equipamentos']),error:e=>{this.error.set(messageFrom(e));this.deleting.set(false);this.confirm.set(false);}});}
}
function messageFrom(e:unknown):string{return e instanceof HttpErrorResponse&&isApiError(e.error)?e.error.message:'Não foi possível concluir a operação.';}
