# Gunakan Node.js versi 18
FROM node:18

# Buat direktori kerja di dalam container
WORKDIR /app

# Copy package.json dan install dependencies
COPY package*.json ./
RUN npm install

# Copy seluruh file proyek ke dalam container
COPY . .

# Wajib untuk Hugging Face Spaces: Set Port ke 7860
ENV PORT=7860
EXPOSE 7860

# Perintah untuk menjalankan server
CMD ["node", "server.js"]