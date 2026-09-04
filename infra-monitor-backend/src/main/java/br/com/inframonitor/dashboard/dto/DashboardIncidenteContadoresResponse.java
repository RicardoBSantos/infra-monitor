package br.com.inframonitor.dashboard.dto;

/**
 * Contadores das abas da tela de Incidentes. Respeitam unidade, severidade e periodo —
 * os mesmos filtros da lista — e ignoram o filtro de status, senao a aba nao selecionada
 * mostraria sempre zero. Nao derivam da pagina: com 20 linhas por pagina os totais
 * estariam errados.
 */
public record DashboardIncidenteContadoresResponse(long abertos, long reconhecidos, long resolvidos, long todos) {
}
