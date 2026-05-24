const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Ruta por defecto
  let filePath = req.url === '/' ? '/index.html' : req.url;
  
  // Construir la ruta completa
  filePath = path.join(__dirname, filePath);
  
  // Seguridad: evitar directory traversal
  const realPath = path.resolve(filePath);
  const baseDir = path.resolve(__dirname);
  
  if (!realPath.startsWith(baseDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  // Leer el archivo
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    // Determinar Content-Type
    let contentType = 'text/plain';
    if (filePath.endsWith('.html')) {
      contentType = 'text/html; charset=utf-8';
    } else if (filePath.endsWith('.css')) {
      contentType = 'text/css; charset=utf-8';
    } else if (filePath.endsWith('.js')) {
      contentType = 'application/javascript; charset=utf-8';
    } else if (filePath.endsWith('.json')) {
      contentType = 'application/json; charset=utf-8';
    } else if (filePath.endsWith('.svg')) {
      contentType = 'image/svg+xml; charset=utf-8';
    } else if (filePath.endsWith('.png')) {
      contentType = 'image/png';
    } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (filePath.endsWith('.gif')) {
      contentType = 'image/gif';
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📁 Sirviendo archivos desde: ${__dirname}`);
});
