#!/bin/bash
set -e

VPS="root@5.104.87.209"
VPS_PATH="/root/vps-deploy/sites/look-and-learn"
SSH_KEY="~/.ssh/id_ed25519"

echo "🚀 開始部署 Look & Learn..."
echo ""

# 1. Git push
echo "📤 推送到 GitHub..."
git add -A && git commit -m "deploy: $(date +%Y-%m-%d_%H:%M)" 2>/dev/null || echo "(無新變更需 commit)"
git push origin master 2>/dev/null || echo "(已是最新)"
echo ""

# 2. 上傳到 VPS（純靜態 HTML，不需 build）
echo "🚢 上傳到 VPS..."
scp -i $SSH_KEY index.html $VPS:$VPS_PATH/index.html
echo ""

# 3. Restart container
echo "🔄 重啟容器..."
ssh -i $SSH_KEY $VPS "docker restart site-look-and-learn"
echo ""

echo "✅ 部署完成！ → https://learn.yen-design.com"
