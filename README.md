# Solar dos Cáceres — site

Site estático (HTML/CSS/JS, sem build).

- `index.html` — página principal
- `content.js` — conteúdos editáveis (preços, quartos, contactos, fotos)
- `admin.html` — área de administração (preços, quartos, contactos, fotos)
- `src/worker.js` — Worker do Cloudflare: serve o site e a API `/api/*` do admin.
  Entrada por email + código (Cloudflare Access); a chave do GitHub fica como secret `GITHUB_TOKEN` no Cloudflare.
  Variáveis: `GITHUB_TOKEN` (secret), `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS`.
  Sem estas variáveis o admin aceita, em alternativa, a chave colada no próprio browser.
- `privacidade.html`, `cookies.html`, `termos.html` — páginas legais

Alojamento: Cloudflare Workers (static assets) ligado a este repositório (cada gravação no admin publica o site em 1–2 minutos).
