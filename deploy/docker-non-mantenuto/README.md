# ⚠ Containerizzazione NON mantenuta

Questi file (Dockerfile, docker-compose, Caddyfile) risalgono alla Fase 1:
- **non sono mai stati costruiti né validati**, perché sulla macchina di sviluppo non c'è Docker;
- **non vengono aggiornati** con le modifiche successive dell'app. Ad esempio mancano le nuove variabili `MAIL_TRANSPORT` e `LOGIN_LOCK_*`.

Restano solo come punto di partenza se in futuro si deciderà di containerizzare. In quel caso vanno rivisti per intero:
- variabili d'ambiente da allineare a `apps/api/.env.example`;
- percorsi;
- header di sicurezza e CSP del Caddyfile;
- `.dockerignore`: Docker lo legge solo nella radice del contesto di build, quindi va spostato nella radice del repository oppure rinominato in `Dockerfile.api.dockerignore` / `Dockerfile.web.dockerignore`.
