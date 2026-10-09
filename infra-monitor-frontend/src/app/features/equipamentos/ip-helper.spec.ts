import { FormControl } from '@angular/forms';
import { motivoRecusaIp, validadorIpv4Monitoravel } from './ip-helper';

describe('motivoRecusaIp', () => {
  it.each([null, undefined, '', '   ', '10.0.0.1', ' 10.0.0.1 ', '223.255.255.255', '127.0.0.1', '10.0.0.0'])(
    'aceita %p', (valor) => expect(motivoRecusaIp(valor)).toBeNull());

  it.each([
    ['2001:db8::1', 'Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6'],
    ['servidor.local', 'IP deve ser um endereço IPv4 no formato 192.168.0.10'],
    ['1a2a3a4', 'IP deve ser um endereço IPv4 no formato 192.168.0.10'],
    ['10 0 0 1', 'IP deve ser um endereço IPv4 no formato 192.168.0.10'],
    ['1,2,3,4', 'IP deve ser um endereço IPv4 no formato 192.168.0.10'],
    ['1.2.3', 'IP deve ser um endereço IPv4 no formato 192.168.0.10'],
    ['1.2.3.4.5', 'IP deve ser um endereço IPv4 no formato 192.168.0.10'],
    ['999.0.0.1', 'Cada octeto do IP vai de 0 a 255'],
    ['256.0.0.1', 'Cada octeto do IP vai de 0 a 255'],
    ['010.0.0.1', 'Octeto com zero à esquerda é ambíguo (pode ser lido como octal): escreva 10.0.0.1, não 010.000.000.001'],
    ['10.0.0.01', 'Octeto com zero à esquerda é ambíguo (pode ser lido como octal): escreva 10.0.0.1, não 010.000.000.001'],
    ['10.00.0.1', 'Octeto com zero à esquerda é ambíguo (pode ser lido como octal): escreva 10.0.0.1, não 010.000.000.001'],
    ['0.0.0.0', 'A faixa 0.0.0.0/8 não é endereço de host'],
    ['255.255.255.255', 'Multicast, reservado ou broadcast (224.0.0.0 em diante) não é endereço de host monitorável'],
  ])('recusa %p', (valor, mensagem) => expect(motivoRecusaIp(valor)).toBe(mensagem));

  it('validator devolve o motivo em `ipv4`', () => {
    expect(validadorIpv4Monitoravel(new FormControl('::1'))).toEqual({ ipv4: 'Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6' });
    expect(validadorIpv4Monitoravel(new FormControl('10.0.0.1'))).toBeNull();
  });
});
