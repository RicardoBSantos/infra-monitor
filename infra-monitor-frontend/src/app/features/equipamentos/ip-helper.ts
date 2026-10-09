import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Mesma regra de `RegraIpv4` (backend), da V20 e de `tools/carga-real`: só IPv4 de host,
 * sem zero à esquerda (o ping do Linux lê "010" como octal). Vazio = sem IP.
 */
export function motivoRecusaIp(valor: string | null | undefined): string | null {
  const ip = (valor ?? '').trim();
  if (!ip) return null;
  if (ip.includes(':')) return 'Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6';
  if (!/^[0-9]{1,3}(.[0-9]{1,3}){3}$/.test(ip)) return 'IP deve ser um endereço IPv4 no formato 192.168.0.10';
  const octetos = ip.split('.');
  if (octetos.some((octeto) => Number(octeto) > 255)) return 'Cada octeto do IP vai de 0 a 255';
  if (octetos.some((octeto) => octeto.length > 1 && octeto.startsWith('0'))) {
    return 'Octeto com zero à esquerda é ambíguo (pode ser lido como octal): escreva 10.0.0.1, não 010.000.000.001';
  }
  const primeiro = Number(octetos[0]);
  if (primeiro === 0) return 'A faixa 0.0.0.0/8 não é endereço de host';
  if (primeiro >= 224) return 'Multicast, reservado ou broadcast (224.0.0.0 em diante) não é endereço de host monitorável';
  return null;
}

export const validadorIpv4Monitoravel: ValidatorFn = (controle: AbstractControl): ValidationErrors | null => {
  const motivo = motivoRecusaIp(controle.value as string | null);
  return motivo ? { ipv4: motivo } : null;
};

/**
 * Classificação informativa do endereço digitado.
 *
 * Só descreve o que foi digitado — quem recusa o envio é `validadorIpv4Monitoravel`
 * (e, no servidor, `RegraIpv4`). Este texto nunca impede o envio.
 */
export function classificarIp(valor: string): string | null {
  const limpo = valor.trim();
  if (!limpo) return null;

  const octetos = limpo.split('.');
  if (octetos.length !== 4 || octetos.some((octeto) => !/^\d{1,3}$/.test(octeto))) {
    return limpo.includes(':') ? 'IPv6 · não suportado pelo monitoramento ICMP atual' : null;
  }

  const numeros = octetos.map(Number);
  if (numeros.some((numero) => numero > 255)) return 'IPv4 · octeto acima de 255';

  const [primeiro, segundo] = numeros;
  if (primeiro === 127) return 'IPv4 · loopback';
  if (primeiro === 10) return 'IPv4 · faixa privada';
  if (primeiro === 172 && segundo >= 16 && segundo <= 31) return 'IPv4 · faixa privada';
  if (primeiro === 192 && segundo === 168) return 'IPv4 · faixa privada';
  if (primeiro === 169 && segundo === 254) return 'IPv4 · link-local';
  if (primeiro >= 224) return 'IPv4 · multicast ou reservado';
  return 'IPv4 · faixa pública';
}
