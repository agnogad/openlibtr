#!/bin/bash

# 1. Önce kütüphane indekslerini güncelle (JS scriptini çalıştır)
echo "🔄 İndeksler güncelleniyor..."
node lib/sync-library.js

# 2. Değişiklikleri git'e ekle
git add .

# 3. Değişikliklere bakarak otomatik mesaj oluştur
# Hangi dosyaların değiştiğini kısa özet olarak alır
CHANGES=$(git status --short)

if [ -z "$CHANGES" ]; then
    echo " "
    echo "ℹ️ Hiçbir değişiklik saptanmadı. Push yapılmıyor."
    exit 0
fi

# Örnek: "Update: books/simyaci, library.json"
COMMIT_MSG="Update: $(echo "$CHANGES" | awk '{print $2}' | cut -d'/' -f1-2 | sort -u | paste -sd ", " -)"

echo "📝 Commit Mesajı: $COMMIT_MSG"

# 4. Commit ve Push işlemleri
git commit -m "$COMMIT_MSG"

echo "🚀 GitHub'a gönderiliyor..."
git push origin main

echo "✅ İşlem tamamlandı!"
