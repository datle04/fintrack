# 1. Base image
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    # ----- A: Thư viện cho Chrome (List dài) -----
    ca-certificates \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    # ----- B: Cài đặt font ROBOTO -----
    fonts-roboto \
    # ----- C: Font dự phòng (Nên có) -----
    fonts-liberation \
    --no-install-recommends \
    # Dọn dẹp cache
    && rm -rf /var/lib/apt/lists/*

# 2. Tạo thư mục app trong container
WORKDIR /app

# 3. Copy file cấu hình
COPY package*.json ./

# 4. Cài dependencies (chỉ production nếu cần)
RUN npm install

# 5. Copy toàn bộ source vào container
COPY . .

# 6. Biên dịch TypeScript (nếu dùng)
RUN npm run build

# 7. Expose port backend
EXPOSE 5000

# 8. Chạy server (hoặc start file JS sau khi build)
CMD ["node", "dist/index.js"]
