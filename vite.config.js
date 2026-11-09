import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

function booksDirectory(server) {
  server.middlewares.use((request, response, next) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/books') {
      response.writeHead(302, { Location: `/books/${url.search}` });
      response.end();
    } else next();
  });
}

export default defineConfig({
  base: './',
  plugins: [{ name: 'books-directory', configureServer: booksDirectory, configurePreviewServer: booksDirectory }],
  build: {
    license: { fileName: 'third-party-licenses.txt' },
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        books: fileURLToPath(new URL('./books/index.html', import.meta.url)),
      },
    },
  },
});
