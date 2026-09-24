import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import { AppIconComponent } from '../app-icon/app-icon.component';
import { BreadcrumbLabelService } from './breadcrumb-label.service';

interface Breadcrumb { label: string; url: string; current: boolean; }

@Component({
  selector: 'app-breadcrumbs',
  imports: [RouterLink, AppIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './breadcrumbs.component.html',
  styleUrl: './breadcrumbs.component.scss',
})
export class BreadcrumbsComponent {
  private readonly router = inject(Router);
  private readonly rotuloDinamico = inject(BreadcrumbLabelService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly navigation = toSignal(this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), map(() => this.router.url), startWith(this.router.url)), { initialValue: this.router.url });
  protected readonly breadcrumbs = computed(() => {
    this.navigation();
    const trilha = this.build(this.activatedRoute.root);
    // Telas de detalhe substituem a última migalha pelo nome do registro aberto.
    const rotulo = this.rotuloDinamico.rotulo();
    if (!rotulo || trilha.length === 0) return trilha;
    return trilha.map((migalha, indice) => (indice === trilha.length - 1 ? { ...migalha, label: rotulo } : migalha));
  });

  private build(route: ActivatedRoute, url = '', breadcrumbs: Breadcrumb[] = []): Breadcrumb[] {
    const child = route.firstChild;
    if (!child) return breadcrumbs.map((breadcrumb, index, all) => ({ ...breadcrumb, current: index === all.length - 1 }));
    const segment = child.snapshot.url.map((part) => part.path).join('/');
    const nextUrl = segment ? `${url}/${segment}` : url;
    const label = child.snapshot.data['breadcrumb'] as string | undefined;
    const secao = child.snapshot.data['section'] as string | undefined;
    if (!label) return this.build(child, nextUrl, breadcrumbs);
    const comSecao = secao && breadcrumbs.length === 0 ? [...breadcrumbs, { label: secao, url: '', current: false }] : breadcrumbs;
    return this.build(child, nextUrl, [...comSecao, { label, url: nextUrl, current: false }]);
  }
}
