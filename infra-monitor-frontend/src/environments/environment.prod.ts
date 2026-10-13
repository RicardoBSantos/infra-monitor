export const environment = {
  production: true,
  // Relativa de propósito: o build de produção é servido na mesma origem da API
  // (backend servindo o estático ou proxy reverso na frente dos dois).
  apiUrl: '/api/v1',
} as const;
