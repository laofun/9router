# Checklist cutover: n9router Docker cu -> Coolify/VPS moi

## Truoc khi bat dau (tren VPS)

```bash
# 1. Xac nhan data cu con nguyen
ls -lah /home/atmdev/n9router-fork/n9router-data
# Ky vong thay: db.json, usage.json, log.txt

# 2. Kiem tra db.json co du lieu
python3 -m json.tool /home/atmdev/n9router-fork/n9router-data/db.json | head -n 40
# Ky vong thay: providerConnections, providerNodes, apiKeys, settings, combos

# 3. Backup lan cuoi (phong mat)
cp -a /home/atmdev/n9router-fork/n9router-data /home/atmdev/n9router-fork/n9router-data.final-backup
```

## Dung instance cu

```bash
# 4. Stop container cu de tranh ghi them du lieu
cd ~/n9router
docker compose stop
```

## Chuan bi env

```bash
# 5. Copy env mau va chinh sua
cp .env.coolify .env
# Doi cac gia tri:
#   JWT_SECRET      -> secret that (giu nguyen cai cu neu muon)
#   INITIAL_PASSWORD -> mat khau dashboard
#   BASE_URL         -> domain thuc te
#   NEXT_PUBLIC_BASE_URL -> domain thuc te
#   API_KEY_SECRET   -> secret cho API key
#   MACHINE_ID_SALT  -> salt cho machine ID
```

## Deploy

```bash
# 6a. Neu dung Docker Compose truc tiep
docker compose -f docker-compose.coolify-ready.yml up -d --build

# 6b. Neu dung Coolify
#   - Source: repo fork
#   - Dockerfile: Dockerfile
#   - Port: 20128
#   - Volume: /home/atmdev/n9router-fork/n9router-data -> /app/data
#   - Env: nhap tung dong tu .env.coolify da chinh sua
```

## Kiem tra sau deploy (5 phut)

```bash
# 7. Container da chay chua?
docker ps | grep n9router

# 8. Health check
curl -s http://localhost:20128/api/health

# 9. Dashboard truy cap duoc?
#    Mo browser: https://n9router.your-domain.com/dashboard
#    Dang nhap bang INITIAL_PASSWORD

# 10. Provider connections con nguyen?
#     Dashboard > Providers — kiem tra danh sach

# 11. Combos / Aliases / API keys con khong?
#     Dashboard > Combos, Model Aliases, API Keys

# 12. Test 1 request that
curl -s https://n9router.your-domain.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"

# 13. Test chat that (thay model va key)
curl -s https://n9router.your-domain.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "ping"}],
    "max_tokens": 10
  }'
```

## Neu co van de

```bash
# Xem log container
docker logs n9router-fork --tail 100

# Kiem tra volume mount dung chua
docker inspect n9router-fork | grep -A5 Mounts

# Kiem tra env trong container
docker exec n9router-fork env | grep -E 'DATA_DIR|PORT|BASE_URL|JWT'

# Neu db.json trong, co the mount sai path
docker exec n9router-fork ls -lah /app/data
```

## Rollback neu can

```bash
# Dung app moi
docker compose -f docker-compose.coolify-ready.yml down

# Khoi dong lai app cu
cd ~/n9router
docker compose up -d

# Restore data neu can
cp -a /home/atmdev/n9router-fork/n9router-data.final-backup/* \
      /home/atmdev/n9router-fork/n9router-data/
```

## Sau khi xac nhan OK

```bash
# Xoa container cu (khi da chac chan app moi on dinh)
cd ~/n9router
docker compose down
docker image prune -f
```
