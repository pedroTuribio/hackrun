# Ponte — imagem para rodar localmente, no notebook da demo ou em qualquer servidor.
# Não há dependências npm: a imagem só copia o código e roda o servidor Node.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Copia apenas o que a aplicação usa em execução
COPY package.json ./
COPY api ./api
COPY lib ./lib
COPY public ./public
COPY data ./data
COPY scripts/dev.js ./scripts/dev.js

# Roda como usuário sem privilégios
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/dev.js"]
