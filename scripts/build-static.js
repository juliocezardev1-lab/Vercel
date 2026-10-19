const fs = require('node:fs');
const path = require('node:path');

const origem = path.resolve(__dirname, '../FRONTEND');
const destino = path.resolve(__dirname, '../dist');

function copiarPublico(origemArquivo, destinoArquivo) {
  const stat = fs.statSync(origemArquivo);
  if (stat.isDirectory()) {
    fs.mkdirSync(destinoArquivo, { recursive: true });
    for (const filho of fs.readdirSync(origemArquivo)) {
      copiarPublico(
        path.join(origemArquivo, filho),
        path.join(destinoArquivo, filho)
      );
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`Arquivo publico invalido: ${origemArquivo}`);
  }
  fs.copyFileSync(origemArquivo, destinoArquivo);
}

if (!fs.existsSync(path.join(origem, 'index.html'))) {
  throw new Error('Painel original nao encontrado.');
}

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });

const publicos = [
  'login.html',
  'login.js',
  'script.js',
  'style.css',
  'IMG',
  'fonts'
];

for (const nome of publicos) {
  const arquivo = path.join(origem, nome);
  if (fs.existsSync(arquivo)) {
    copiarPublico(arquivo, path.join(destino, nome));
  }
}

if (!fs.existsSync(path.join(destino, 'login.html'))) {
  throw new Error('Pagina publica de login ausente.');
}

if (fs.existsSync(path.join(destino, 'index.html'))) {
  throw new Error('O painel privado foi incluido indevidamente.');
}

console.log('Build publico concluido. Painel privado protegido.');