/**
 * Classificação informativa do endereço digitado.
 *
 * Só descreve o que foi digitado — a validação de formato continua sendo a do formulário
 * e a do backend. Um texto aqui nunca impede o envio.
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
