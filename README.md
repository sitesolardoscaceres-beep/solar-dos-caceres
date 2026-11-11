# Solar dos Cáceres — site

Site estático (HTML/CSS/JS, sem build).

- `index.html` — página principal
- `content.js` — conteúdos editáveis (preços, quartos, contactos, fotos)
- `admin.html` — área de administração (preços, quartos, contactos, fotos)
- `worker.js` — Worker do Cloudflare: serve o site e a API `/api/*` do admin.
  Entrada com palavra-passe (secret `ADMIN_PASSWORD`) ou, opcionalmente, Cloudflare Access; a chave do GitHub fica como secret `GITHUB_TOKEN`.
  Variáveis: `GITHUB_TOKEN` e `ADMIN_PASSWORD` (secrets); opcionais `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS`.
  Sem estas variáveis o admin aceita, em alternativa, a chave colada no próprio browser.
- `privacidade.html`, `cookies.html`, `termos.html` — páginas legais

Alojamento: Cloudflare Workers (static assets) ligado a este repositório (cada gravação no admin publica o site em 1–2 minutos).
