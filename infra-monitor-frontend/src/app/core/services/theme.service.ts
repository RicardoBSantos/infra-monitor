import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type Tema = 'dark' | 'light';

const CHAVE_ARMAZENAMENTO = 'infra-monitor.tema';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly temaSignal = signal<Tema>('dark');
  readonly tema = this.temaSignal.asReadonly();

  constructor() { this.aplicar(this.temaInicial()); }

  set(tema: Tema): void { this.aplicar(tema); this.persistir(tema); }
  toggle(): void { this.set(this.temaSignal() === 'dark' ? 'light' : 'dark'); }

  private aplicar(tema: Tema): void {
    this.temaSignal.set(tema);
    this.document.documentElement.setAttribute('data-theme', tema);
  }

  /** Preferência salva vence; sem ela, segue o sistema operacional. */
  private temaInicial(): Tema {
    const salvo = this.lerArmazenado();
    if (salvo !== null) return salvo;
    const janela = this.document.defaultView;
    if (typeof janela?.matchMedia !== 'function') return 'dark';
    return janela.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  private lerArmazenado(): Tema | null {
    try {
      const valor = this.document.defaultView?.localStorage.getItem(CHAVE_ARMAZENAMENTO);
      return valor === 'dark' || valor === 'light' ? valor : null;
    } catch { return null; }
  }

  private persistir(tema: Tema): void {
    try { this.document.defaultView?.localStorage.setItem(CHAVE_ARMAZENAMENTO, tema); } catch { /* modo privado bloqueia storage */ }
  }
}
