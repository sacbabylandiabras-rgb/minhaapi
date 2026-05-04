#!/bin/bash
docker start zapi-redis zapi-postgres 2>/dev/null || \
  (docker run -d --name zapi-redis -p 6379:6379 redis:7-alpine && \
   docker run -d --name zapi-postgres \
     -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=zapiclone -p 5432:5432 postgres:16-alpine)
sleep 3
cd /workspaces/minhaapi/zapi-clone && npm run dev
