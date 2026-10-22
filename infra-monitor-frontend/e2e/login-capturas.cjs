/*
 * Capturas da tela de login nos dois temas, desktop e celular (somente leitura: não autentica).
 *   E2E_BASE=http://localhost:4200 ROTULO=antes|depois node e2e/login-capturas.cjs
 * Saída: e2e/login-evidence/<ROTULO>-<tema>-<largura>.png e, no stdout, a geometria do bloco de marca.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.E2E_BASE || 'http://localhost:4200';
const ROTULO = process.env.ROTULO; if (!ROTULO) throw new Error('ROTULO é obrigatório');
const SAIDA = path.join(__dirname, 'login-evidence');
const TAMANHOS = [{ w: 1593, h: 883 }, { w: 1366, h: 768 }, { w: 390, h: 844 }];

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const tema of ['dark', 'light']) {
      for (const { w, h } of TAMANHOS) {
        const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
        await context.addInitScript(t => localStorage.setItem('infra-monitor.tema', t), tema);
        const page = await context.newPage();
        await page.goto(`${BASE}/login`);
        await page.locator('.login-card').waitFor();
        const geo = await page.evaluate(() => {
          const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; };
          return { brand: r('.login-brand'), conteudo: r('.login-brand__content'), card: r('.login-card'), chips: !!document.querySelector('.login-chips'), texto: document.querySelector('.login-brand__content')?.innerText.replace(/\s+/g, ' ') };
        });
        console.log(JSON.stringify({ tema, w, ...geo }));
        await page.screenshot({ path: path.join(SAIDA, `${ROTULO}-${tema}-${w}.png`), fullPage: true });
        await context.close();
      }
    }
  } finally { await browser.close(); }
})();
